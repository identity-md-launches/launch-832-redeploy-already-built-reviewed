// Real EVM integration of the same client used by the browser. Requires forge build and anvil.
// Uses local unlocked test accounts only; no keys or external RPCs are read.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { ContractFactory, JsonRpcProvider, keccak256, parseEther } from '../vendor/ethers.js';
import { KingClient } from '../src/client.js';
import { canDethrone, minimumOutput } from '../src/core.js';

const root = new URL('../../', import.meta.url);
// Foundry's default dynamic test linking inserts cheatcode deployments in large test fixtures.
// Anvil has no cheatcodes: compile this aggregate fixture as ordinary bytecode in scratch only.
execFileSync('forge', ['build', '--no-dynamic-test-linking', '--out', 'test/scratch/web-out', '--cache-path', 'test/scratch/web-cache'], {cwd: root, stdio: 'pipe'});
const keep = process.argv.includes('--serve');
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const anvil = spawn('anvil', ['--port', String(port), '--chain-id', '4663', '--hardfork', 'cancun', '--code-size-limit', '120000', '--gas-limit', '300000000', '--silent'], {stdio: 'ignore'});
let launchError;
anvil.on('error', e => launchError = e);
const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, undefined, {batchMaxCount: 1, cacheTimeout: -1});
provider.pollingInterval = 50;
async function wait(tx) { const r = await tx.wait(); assert.equal(r.status, 1); return r; }
try {
  let started = false;
  for (let i = 0; i < 50; i++) {
    if (launchError) throw launchError;
    try { await provider.send('eth_chainId', []); started = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(started, 'Anvil did not start');
  const owner = await provider.getSigner(0), alice = await provider.getSigner(1), bob = await provider.getSigner(2);
  const artifact = JSON.parse(await readFile(new URL('test/scratch/web-out/WebLaunchFixture.sol/WebLaunchFixture.json', root)));
  const fixture = await new ContractFactory(artifact.abi, artifact.bytecode.object, owner).deploy({gasLimit: 250000000});
  const receipt = await fixture.deploymentTransaction().wait();
  console.log('Local fixture deployed.');
  const config = JSON.parse(await readFile(new URL('../public/imd-deployment.json', import.meta.url)));
  Object.assign(config, {status: 'live', hook: await fixture.hook(), token: await fixture.token(), poolManager: await fixture.manager(), deploymentTransaction: receipt.hash, deploymentBlock: receipt.blockNumber, codeHashes: {}});
  const abis = {};
  for (const n of ['KingHook', 'KingRouter', 'KingToken']) abis[n] = JSON.parse(await readFile(new URL(`../public/abi/${n}.json`, import.meta.url)));
  const { Contract } = await import('../vendor/ethers.js');
  config.router = await new Contract(config.hook, abis.KingHook, provider).router();
  for (const key of ['hook', 'token', 'router', 'poolManager']) config.codeHashes[key] = keccak256(await provider.getCode(config[key]));
  const client = new KingClient(config, abis, provider);
  await client.verify();
  console.log('Deployment identity verified.');
  const deadline = () => Math.floor(Date.now() / 1000) + 100000;
  assert.equal(await provider.getBalance(config.poolManager), 0n, 'token-only pool starts with no ETH');
  const early = {buy: true, input: parseEther('0.1'), mustTake: false, deadline: deadline()};
  await assert.rejects(() => client.quote(alice, {...early, mustTake: true}), 'anti-snipe must-take rejects');
  const earlyOut = await client.quote(alice, early);
  await wait(await client.trade(alice, {...early, minimum: minimumOutput(earlyOut, '0.5')}));
  console.log('Fresh-manager anti-snipe buy passed.');
  assert.ok(await client.token.balanceOf(await alice.getAddress()) > 0n);
  await provider.send('evm_increaseTime', [1801]); await provider.send('evm_mine', []);
  const takeover = {...early, mustTake: true};
  const quoted = await client.quote(alice, takeover);
  await assert.rejects(() => client.trade(alice, {...takeover, minimum: quoted + parseEther('1000000')}), 'slippage rejects');
  await wait(await client.trade(alice, {...takeover, minimum: minimumOutput(quoted, '0.5')}));
  console.log('Must-take and slippage checks passed.');
  let s = await client.snapshot(await alice.getAddress());
  assert.equal(s.throne.king, await alice.getAddress()); assert.equal(s.reigns.length, 1);
  assert.equal(s.income, 0n, 'first five minutes provisional');
  await assert.rejects(() => client.act(bob, 'dethrone'), 'sufficient holdings reject');
  await assert.rejects(() => client.act(alice, 'claim'), 'unvested income rejects');
  await provider.send('evm_increaseTime', [301]); await provider.send('evm_mine', []);
  s = await client.snapshot(await alice.getAddress()); assert.ok(s.income > 0n);
  await wait(await client.act(alice, 'claim'));
  console.log('Vested claim passed.');
  await wait(await client.token.connect(alice).transfer(await bob.getAddress(), s.balance));
  s = await client.snapshot(await alice.getAddress()); assert.equal(canDethrone(s.throne), true);
  await wait(await client.act(bob, 'dethrone'));
  console.log('Holding failure and dethrone passed.');
  assert.equal((await client.snapshot(null)).throne.king, '0x' + '0'.repeat(40));
  const sell = {buy: false, input: (await client.token.balanceOf(await bob.getAddress())) / 2n, mustTake: false, deadline: deadline()};
  assert.ok(sell.input > 0n);
  await assert.rejects(() => client.quote(bob, sell), 'sell without approval rejects');
  await wait(await client.approve(bob, sell.input));
  assert.equal(await client.allowance(await bob.getAddress()), sell.input);
  const sellOut = await client.quote(bob, sell);
  await wait(await client.trade(bob, {...sell, minimum: minimumOutput(sellOut, '0.5')}));
  assert.equal(await client.allowance(await bob.getAddress()), 0n);
  assert.equal((await client.snapshot(null)).reigns[0].reason, 3n);
  const corrupted = new KingClient({...config, codeHashes: {...config.codeHashes, hook: '0x' + '0'.repeat(64)}}, abis, provider);
  await assert.rejects(() => corrupted.verify(), /deployed code/);
  console.log('PASS: deployment verification, fresh token-only buy, must-take refusal/success, slippage, vesting, claim, holdings, dethrone, exact approval, sell, history, and wrong-code refusal.');
  if (keep) {
    const path = new URL('test/scratch/web-fixture.json', root);
    await mkdir(new URL('test/scratch/', root), {recursive: true});
    await writeFile(path, JSON.stringify({config, rpc: `http://127.0.0.1:${port}`, accounts: await provider.send('eth_accounts', [])}, null, 2));
    console.log(`Local browser fixture ready: ${path.pathname}`);
    await new Promise(resolve => { process.on('SIGTERM', resolve); process.on('SIGINT', resolve); });
  }
} catch (error) {
  console.error(error.shortMessage || error.message);
  console.error((error.stack || '').split('\n').filter(line => line.trim().startsWith('at ')).slice(-3).join('\n'));
  if (error.data) console.error('Revert data:', error.data);
  process.exitCode = 1;
} finally { provider.destroy(); anvil.kill('SIGTERM'); }
