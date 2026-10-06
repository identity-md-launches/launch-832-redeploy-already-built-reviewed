import { BrowserProvider, ZeroAddress } from '../vendor/ethers.js';
import { KingClient } from './client.js';
import { validateConfig, sameAddress, amount, minimumOutput, units, short, duration, canDethrone, validQuote, TEAM } from './core.js';

const $ = id => document.getElementById(id);
const state = { config: null, client: null, live: false, busy: false, refreshing: false, account: null, wallet: null, buy: true, page: 0, snapshot: null, quote: null, fetchedAt: 0, epoch: 0 };
function message(text, error = false, hash = null) {
  const node = $('message'); node.hidden = false; node.classList.toggle('error', error); node.textContent = text;
  if (hash && /^0x[0-9a-f]{64}$/i.test(hash)) {
    const a = document.createElement('a'); a.href = `${state.config.explorerUrl}/tx/${hash}`; a.textContent = ' View transaction ↗'; a.target = '_blank'; a.rel = 'noopener noreferrer'; node.append(a);
  }
}
function describe(error) {
  if (error.code === 4001 || error.code === 'ACTION_REJECTED') return 'Request declined in your wallet. No new transaction was submitted.';
  if (error.code === 'INSUFFICIENT_FUNDS') return 'Insufficient ETH for this trade and gas.';
  const text = error.shortMessage || error.reason || error.message || 'The request failed.';
  return text.slice(0, 450) + (error.code === 'CALL_EXCEPTION' ? ' The throne, holdings, allowance, balance, deadline, or minimum output may have changed. Refresh and preview again.' : '');
}
function route() {
  const page = ['throne', 'trade', 'claim', 'about'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'throne';
  document.querySelectorAll('.page').forEach(n => n.hidden = n.id !== page);
  document.querySelectorAll('nav a').forEach(a => a.getAttribute('href') === `#${page}` ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
}
function fingerprint() { return JSON.stringify([state.buy, $('trade-amount').value, $('slippage').value, $('must-take').checked]); }
function fresh() { return !!state.snapshot && Date.now() - state.fetchedAt < 30000; }
function updateButtons() {
  const enabled = state.live && state.account && !state.busy && fresh();
  $('quote').disabled = !enabled;
  $('approve').disabled = !enabled;
  $('submit-trade').disabled = !enabled || !validQuote(state.quote, {account: state.account, fingerprint: fingerprint()});
  $('claim-income').disabled = !enabled || state.snapshot.income < 1n;
  $('dethrone').disabled = !enabled || !canDethrone(state.snapshot.throne);
  $('connect').disabled = !state.live || state.busy;
  $('refresh').disabled = !state.live || state.refreshing;
  $('older').disabled = !state.live || state.refreshing || !state.snapshot?.older;
  $('newer').disabled = !state.live || state.refreshing || !state.page;
}
function invalidateQuote() {
  state.quote = null;
  $('quote-output').textContent = '—'; $('quote-minimum').textContent = '—'; $('quote-age').textContent = '30 seconds'; updateButtons();
}
function addressLink(a, full = false) {
  const link = document.createElement('a'); link.textContent = full ? a : short(a); link.title = a;
  link.href = `${state.config.explorerUrl}/address/${a}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}
function renderAddresses() {
  const list = $('addresses'); list.replaceChildren();
  for (const [name, addr] of [['KING token', state.config.token], ['King hook', state.config.hook], ['King router', state.config.router], ['PoolManager', state.config.poolManager], ['Team wallet', TEAM]]) {
    const dt = document.createElement('dt'); dt.textContent = name;
    const dd = document.createElement('dd'); if (addr) dd.append(addressLink(addr, true)); else dd.textContent = 'Awaiting deployment'; list.append(dt, dd);
  }
}
function clockNow() { return state.snapshot ? state.snapshot.timestamp + Math.min(30, Math.floor((Date.now() - state.fetchedAt) / 1000)) : 0; }
function tick() {
  if (state.snapshot) {
    const t = state.snapshot.throne, now = clockNow(), occupied = !sameAddress(t.king, ZeroAddress);
    $('reign-time').textContent = occupied ? `Reigning for approximately ${duration(now - Number(t.reignStart))}` : 'The next qualifying buy can claim the crown.';
    $('halving').textContent = t.nextHalving === 0n ? 'At the 0.01 ETH floor' : `Next hourly halving in ≈ ${duration(Number(t.nextHalving) - now)}`;
    $('vesting').textContent = occupied && Number(t.vestsAt) > now ? `${units(t.kingVesting)} ETH provisional · vests in ≈ ${duration(Number(t.vestsAt) - now)}` : 'Income is vested after five minutes of holding the throne.';
    $('trade-game').textContent = t.gameOpen ? 'The game is open. A qualifying buy takes the throne.' : `Game opens in ≈ ${duration(Number(t.gameStart) - now)}. Must-take buys revert until then.`;
    $('read-status').textContent = fresh() ? `BLOCK ${state.snapshot.block.toLocaleString()} · ${Math.floor((Date.now() - state.fetchedAt) / 1000)}s AGO` : 'DATA IS STALE · REFRESH TO ACT';
  }
  if (state.quote) $('quote-age').textContent = `${Math.max(0, 30 - Math.floor((Date.now() - state.quote.createdAt) / 1000))}s remaining`;
  updateButtons();
}
function render() {
  const s = state.snapshot, t = s.throne, occupied = !sameAddress(t.king, ZeroAddress);
  $('king').replaceChildren(occupied ? addressLink(t.king) : document.createTextNode('The throne is empty'));
  $('king-earned').textContent = `${units(t.kingReignEarnings)} ETH`;
  $('king-claimable').textContent = `${units(t.kingUnclaimed)} ETH`;
  $('throne-price').textContent = `${units(t.thronePrice)} ETH`;
  $('pool-size').textContent = `${units(t.poolSize)} ETH`;
  $('income-hour').textContent = `${units(t.incomePerHour)} ETH`;
  const fee = `${(Number(t.feeRate) / 10000).toFixed(3).replace(/\.?0+$/, '')}%`;
  $('hook-fee').textContent = fee; $('trade-fee').textContent = fee;
  $('trade-price').textContent = `Current throne price: ${units(t.thronePrice)} ETH in a single buy.`;
  $('own-income').textContent = state.account ? `${units(s.income)} ETH` : '— ETH';
  $('own-address').textContent = state.account ? `Connected: ${state.account}` : 'Connect your wallet to see your income.';
  $('wallet-balance').textContent = state.account ? `Balance: ${units(state.buy ? s.ethBalance : s.balance)} ${state.buy ? 'ETH' : 'KING'}` : 'Connect to see your balance.';
  $('required').textContent = units(t.requiredBalance); $('held').textContent = units(t.kingBalance);
  $('holding-status').textContent = !occupied ? 'The throne is empty.' : canDethrone(t) ? 'The king is below the holding requirement and can be dethroned.' : 'The king currently holds enough KING.';
  const rows = $('history'); rows.replaceChildren();
  for (const r of s.reigns) {
    const tr = document.createElement('tr'), king = document.createElement('td'); king.append(addressLink(r.king)); tr.append(king);
    for (const value of [new Date(Number(r.start) * 1000).toLocaleString(), duration(Number(r.end || BigInt(s.timestamp)) - Number(r.start)), `${units(r.earned)} ETH`, ['Reigning', 'Outbid', 'Sold', 'Below holding requirement'][Number(r.reason)]]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    rows.append(tr);
  }
  if (!s.reigns.length) { const row = rows.insertRow(); const cell = row.insertCell(); cell.colSpan = 5; cell.textContent = 'No reigns yet. The crown is waiting.'; }
  tick();
}
async function refresh() {
  if (!state.live || state.refreshing) return;
  state.refreshing = true; updateButtons(); const epoch = state.epoch;
  try {
    const snapshot = await state.client.snapshot(state.account, state.page);
    if (epoch !== state.epoch) return;
    state.snapshot = snapshot; state.fetchedAt = Date.now(); render();
  } catch (e) { state.fetchedAt = 0; invalidateQuote(); message(`Live read failed. ${describe(e)}`, true); }
  finally {
    state.refreshing = false; updateButtons();
    if (epoch !== state.epoch) refresh();
  }
}
async function connect() {
  if (!window.ethereum) throw Error('Open this site in an EVM wallet browser, or install an EVM wallet extension.');
  await window.ethereum.request({method: 'eth_requestAccounts'});
  const target = '0x' + state.config.chainId.toString(16);
  if (await window.ethereum.request({method: 'eth_chainId'}) !== target) {
    try { await window.ethereum.request({method: 'wallet_switchEthereumChain', params: [{chainId: target}]}); }
    catch (e) {
      if (e.code !== 4902) throw e;
      await window.ethereum.request({method: 'wallet_addEthereumChain', params: [{chainId: target, chainName: state.config.chainName, rpcUrls: [state.config.rpcUrl], blockExplorerUrls: [state.config.explorerUrl], nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18}}]});
      await window.ethereum.request({method: 'wallet_switchEthereumChain', params: [{chainId: target}]});
    }
  }
  state.wallet = new BrowserProvider(window.ethereum, 'any');
  const accounts = await window.ethereum.request({method: 'eth_accounts'});
  state.account = accounts[0] || null; state.epoch++; invalidateQuote();
  $('connect').textContent = state.account ? short(state.account) : 'Connect wallet';
  message(state.account ? 'Connected to Robinhood Chain.' : 'No wallet account selected.');
  await refresh();
}
async function signer() {
  if (!state.live || !state.account || !fresh()) throw Error('Connect to Robinhood Chain and refresh live data first.');
  const chain = await window.ethereum.request({method: 'eth_chainId'});
  const accounts = await window.ethereum.request({method: 'eth_accounts'});
  if (Number(BigInt(chain)) !== state.config.chainId || !sameAddress(accounts[0], state.account)) throw Error('Wallet changed. Reconnect before continuing.');
  return state.wallet.getSigner(state.account);
}
async function run(action) {
  if (state.busy) return;
  state.busy = true; updateButtons();
  try { await action(); } catch (e) { invalidateQuote(); message(describe(e), true); }
  finally { state.busy = false; updateButtons(); }
}
async function confirm(tx, label) {
  invalidateQuote(); message(`${label} submitted. Waiting for confirmation…`, false, tx.hash);
  let receipt;
  try { receipt = await tx.wait(); }
  catch (e) {
    if (e.code !== 'TRANSACTION_REPLACED' || e.cancelled) throw e;
    receipt = e.receipt;
  }
  if (!receipt || receipt.status !== 1) throw Error('Transaction reverted. Refresh before trying again.');
  message(`${label} confirmed.`, false, receipt.hash); await refresh();
}
function tradeDirection(buy) {
  state.buy = buy; invalidateQuote();
  $('buy-tab').setAttribute('aria-pressed', String(buy)); $('sell-tab').setAttribute('aria-pressed', String(!buy));
  $('amount-label').textContent = buy ? 'You pay · ETH' : 'You sell · KING';
  $('trade-amount').value = ''; $('trade-amount').placeholder = buy ? '0.01' : '1000';
  $('must-take').checked = false; $('must-take').closest('label').hidden = !buy; $('must-help').hidden = !buy;
  $('approve').hidden = buy; $('submit-trade').textContent = buy ? 'Confirm buy' : 'Confirm sell';
  if (state.snapshot) render();
}
function bind() {
  window.addEventListener('hashchange', route); route();
  $('connect').onclick = () => run(connect);
  $('refresh').onclick = refresh;
  $('newer').onclick = () => { state.page = Math.max(0, state.page - 1); refresh(); };
  $('older').onclick = () => { state.page++; refresh(); };
  $('buy-tab').onclick = () => tradeDirection(true); $('sell-tab').onclick = () => tradeDirection(false);
  for (const id of ['trade-amount', 'slippage', 'must-take']) $(id).addEventListener('input', invalidateQuote);
  $('approve').onclick = () => run(async () => {
    const wallet = await signer(), input = amount($('trade-amount').value);
    if (await state.client.allowance(state.account) >= input) { message('Your current KING allowance already covers this amount. Preview the sell.'); return; }
    await confirm(await state.client.approve(wallet, input), 'KING approval');
  });
  $('quote').onclick = () => run(async () => {
    invalidateQuote(); const wallet = await signer(), fp = fingerprint(), account = state.account;
    const input = amount($('trade-amount').value), buy = state.buy, mustTake = $('must-take').checked;
    if (!buy && await state.client.allowance(account) < input) throw Error('Approve the exact KING amount first, then preview the sell.');
    const raw = await state.client.provider.send('eth_getBlockByNumber', ['latest', false]);
    const deadline = Number(BigInt(raw.timestamp)) + 300;
    const output = await state.client.quote(wallet, {buy, input, mustTake, deadline});
    if (fp !== fingerprint() || !sameAddress(account, state.account)) throw Error('Trade or wallet changed. Preview again.');
    const minimum = minimumOutput(output, $('slippage').value);
    state.quote = {buy, input, mustTake, deadline, output, minimum, fingerprint: fp, account, createdAt: Date.now()};
    $('quote-output').textContent = `${units(output)} ${buy ? 'KING' : 'ETH'}`;
    $('quote-minimum').textContent = `${units(minimum)} ${buy ? 'KING' : 'ETH'}`;
    message('Preview ready. Review the minimum received before confirming.'); tick();
  });
  $('trade-form').onsubmit = e => { e.preventDefault(); run(async () => {
    const wallet = await signer();
    if (!validQuote(state.quote, {account: state.account, fingerprint: fingerprint()})) throw Error('Preview expired or changed. Get a fresh preview.');
    const q = state.quote; await confirm(await state.client.trade(wallet, q), q.buy ? 'Buy' : 'Sell');
  }); };
  $('claim-income').onclick = () => run(async () => confirm(await state.client.act(await signer(), 'claim'), 'Claim'));
  $('dethrone').onclick = () => run(async () => confirm(await state.client.act(await signer(), 'dethrone'), 'Dethrone'));
  const walletChanged = () => {
    state.epoch++; state.account = null; state.wallet = null; state.snapshot = null; state.fetchedAt = 0;
    invalidateQuote(); $('connect').textContent = 'Reconnect wallet';
    $('own-income').textContent = '— ETH'; $('own-address').textContent = 'Reconnect to refresh your account.'; $('wallet-balance').textContent = 'Reconnect to refresh your balance.';
    message('Wallet account or network changed. Reconnect to continue.'); refresh();
  };
  window.ethereum?.on?.('accountsChanged', walletChanged); window.ethereum?.on?.('chainChanged', walletChanged); window.ethereum?.on?.('disconnect', walletChanged);
}
async function init() {
  bind();
  try {
    const response = await fetch('./imd-deployment.json'); if (!response.ok) throw Error('Deployment configuration is unavailable.');
    state.config = await response.json(); renderAddresses();
    if (!validateConfig(state.config)) {
      $('deployment-notice').hidden = false; $('read-status').textContent = 'AWAITING DEPLOYMENT'; $('connect').disabled = true; $('refresh').disabled = true; return;
    }
    const names = ['KingHook', 'KingRouter', 'KingToken'];
    const abis = Object.fromEntries(await Promise.all(names.map(async name => {
      const r = await fetch(`./abi/${name}.json`); if (!r.ok) throw Error(`ABI unavailable: ${name}`); return [name, await r.json()];
    })));
    state.client = new KingClient(state.config, abis); await state.client.verify(); state.live = true;
    $('address-note').textContent = 'Contract identities and runtime hashes verified against this release.';
    await refresh(); setInterval(refresh, 12000); setInterval(tick, 1000);
  } catch (e) { state.live = false; $('read-status').textContent = 'CONNECTION UNAVAILABLE'; message(describe(e), true); updateButtons(); }
}
init();
