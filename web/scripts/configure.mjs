// Read-only deployment binding. No key, wallet, transaction broadcast, or environment variables.
import { readFile, writeFile } from 'node:fs/promises';
import { Contract, JsonRpcProvider, keccak256, getAddress } from '../vendor/ethers.js';
import { KingClient } from '../src/client.js';
import { validateConfig } from '../src/core.js';

const [hookAddress, transactionHash, rpcOverride] = process.argv.slice(2);
if (!hookAddress || !transactionHash) throw Error('Usage: node web/scripts/configure.mjs <attested-hook-address> <deployment-tx-hash> [public-https-rpc]');
const base = new URL('../public/', import.meta.url);
const config = JSON.parse(await readFile(new URL('imd-deployment.json', base)));
if (rpcOverride) config.rpcUrl = rpcOverride;
if (new URL(config.rpcUrl).protocol !== 'https:') throw Error('Use a public HTTPS RPC. Never put a secret RPC key in this public config.');
const abis = {};
for (const name of ['KingHook', 'KingRouter', 'KingToken']) abis[name] = JSON.parse(await readFile(new URL(`abi/${name}.json`, base)));
const provider = new JsonRpcProvider(config.rpcUrl, undefined, {batchMaxCount: 1});
try {
  if (Number(BigInt(await provider.send('eth_chainId', []))) !== 4663) throw Error('Expected Robinhood Chain 4663.');
  const hook = new Contract(getAddress(hookAddress), abis.KingHook, provider);
  const [token, router, poolManager, receipt] = await Promise.all([hook.token(), hook.router(), hook.poolManager(), provider.getTransactionReceipt(transactionHash)]);
  if (!receipt || receipt.status !== 1) throw Error('Successful deployment receipt required.');
  const launch = receipt.logs.find(log => {
    if (log.address.toLowerCase() !== hook.target.toLowerCase()) return false;
    try { return hook.interface.parseLog(log)?.name === 'PoolLaunched'; } catch { return false; }
  });
  if (!launch) throw Error('Receipt must initialize this hook in the factory deployment transaction.');
  Object.assign(config, {status: 'live', hook: hook.target, token, router, poolManager, deploymentTransaction: receipt.hash, deploymentBlock: receipt.blockNumber, codeHashes: {}});
  for (const key of ['hook', 'token', 'router', 'poolManager']) {
    const code = await provider.getCode(config[key]);
    if (code === '0x') throw Error(`No deployed code: ${key}`);
    config.codeHashes[key] = keccak256(code);
  }
  validateConfig(config, true);
  await new KingClient(config, abis, provider).verify();
  await writeFile(new URL('imd-deployment.json', base), JSON.stringify(config, null, 2) + '\n');
  console.log('Verified and saved the Robinhood deployment. Build with --release before publication.');
} finally { provider.destroy(); }
