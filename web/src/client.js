import { Contract, JsonRpcProvider, keccak256, ZeroAddress } from '../vendor/ethers.js';
import { validateConfig, sameAddress, TEAM } from './core.js';

export class KingClient {
  constructor(config, abis, provider = null) {
    this.config = config;
    this.abis = abis;
    this.provider = provider || new JsonRpcProvider(config.rpcUrl, undefined, { batchMaxCount: 1 });
    this.hook = new Contract(config.hook, abis.KingHook, this.provider);
    this.token = new Contract(config.token, abis.KingToken, this.provider);
    this.router = new Contract(config.router, abis.KingRouter, this.provider);
  }
  async verify() {
    validateConfig(this.config, true);
    const c = this.config;
    if (Number(BigInt(await this.provider.send('eth_chainId', []))) !== c.chainId) throw Error('RPC is on the wrong chain.');
    for (const key of ['hook', 'token', 'router', 'poolManager']) {
      const code = await this.provider.getCode(c[key]);
      if (code === '0x' || keccak256(code) !== c.codeHashes[key]) throw Error(`${key} deployed code does not match this release.`);
    }
    const [token, manager, router, initialized, key, supply, decimals, symbol, name, team, rHook, rToken, rManager, receipt] = await Promise.all([
      this.hook.token(), this.hook.poolManager(), this.hook.router(), this.hook.initialized(), this.hook.poolKey(),
      this.token.totalSupply(), this.token.decimals(), this.token.symbol(), this.token.name(), this.hook.TEAM_WALLET(),
      this.router.hook(), this.router.token(), this.router.poolManager(), this.provider.getTransactionReceipt(c.deploymentTransaction)
    ]);
    if (!sameAddress(token, c.token) || !sameAddress(manager, c.poolManager) || !sameAddress(router, c.router) ||
        !sameAddress(rHook, c.hook) || !sameAddress(rToken, c.token) || !sameAddress(rManager, c.poolManager) ||
        !initialized || !sameAddress(key.currency0, ZeroAddress) || !sameAddress(key.currency1, c.token) ||
        !sameAddress(key.hooks, c.hook) || key.fee !== 12500n || key.tickSpacing !== 60n ||
        supply !== 10n ** 27n || decimals !== 18n || name !== 'KING' || symbol !== 'KING' || !sameAddress(team, TEAM)) throw Error('The deployed KING contracts do not match the release configuration.');
    if (!receipt || receipt.status !== 1 || receipt.blockNumber !== c.deploymentBlock) throw Error('Deployment receipt is unavailable or unsuccessful.');
  }
  async snapshot(account, page = 0) {
    const raw = await this.provider.send('eth_getBlockByNumber', ['latest', false]);
    const block = Number(BigInt(raw.number));
    const options = { blockTag: block };
    const [throne, count, income, balance, ethBalance] = await Promise.all([
      this.hook.throne(options), this.hook.reignCount(options),
      account ? this.hook.unclaimedIncome(account, options) : 0n,
      account ? this.token.balanceOf(account, options) : 0n,
      account ? this.provider.getBalance(account, block) : 0n
    ]);
    const end = count > BigInt(page * 10) ? count - BigInt(page * 10) : 0n;
    const start = end > 10n ? end - 10n : 0n;
    const reigns = end > start ? await this.hook.getReigns(start, end - start, options) : [];
    return { throne, count, income, balance, ethBalance, reigns: [...reigns].reverse(), block, timestamp: Number(BigInt(raw.timestamp)), older: start > 0n };
  }
  async quote(signer, {buy, input, mustTake, deadline}) {
    const router = this.router.connect(signer);
    return buy
      ? router.buyExactIn.staticCall(0n, mustTake, deadline, {value: input})
      : router.sellExactIn.staticCall(input, 0n, deadline);
  }
  async allowance(account) { return this.token.allowance(account, this.config.router); }
  async approve(signer, input) {
    const token = this.token.connect(signer);
    await token.approve.staticCall(this.config.router, input);
    return token.approve(this.config.router, input, {chainId: this.config.chainId});
  }
  async trade(signer, {buy, input, minimum, mustTake, deadline}) {
    if (minimum < 1n) throw Error('A positive minimum output is required.');
    const router = this.router.connect(signer);
    if (buy) {
      await router.buyExactIn.staticCall(minimum, mustTake, deadline, {value: input});
      return router.buyExactIn(minimum, mustTake, deadline, {value: input, chainId: this.config.chainId});
    }
    await router.sellExactIn.staticCall(input, minimum, deadline);
    return router.sellExactIn(input, minimum, deadline, {chainId: this.config.chainId});
  }
  async act(signer, name) {
    if (!['claim', 'dethrone'].includes(name)) throw Error('Unknown action.');
    const method = this.hook.connect(signer).getFunction(name);
    await method.staticCall();
    return method({chainId: this.config.chainId});
  }
}
