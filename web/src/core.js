import { parseUnits, formatUnits, isAddress, ZeroAddress } from '../vendor/ethers.js';

export const CHAIN_ID = 4663;
export const TEAM = '0x39E3414e7a43DE41675e9bEC52F7C9F6ae489CB6';
export const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export function validateConfig(c, release = false) {
  if (c.chainId !== CHAIN_ID || c.poolFee !== 12500 || c.tickSpacing !== 60) throw Error('Unexpected network or pool configuration.');
  for (const key of ['rpcUrl', 'explorerUrl']) {
    if (new URL(c[key]).protocol !== 'https:') throw Error('Network URLs must use HTTPS.');
  }
  if (c.status !== 'live') {
    if (release) throw Error('Release refused: a verified deployment is required.');
    if (c.status !== 'awaiting-deployment') throw Error('Unknown deployment status.');
    return false;
  }
  for (const key of ['hook', 'token', 'router', 'poolManager']) {
    if (!isAddress(c[key]) || sameAddress(c[key], ZeroAddress)) throw Error(`Missing ${key} address.`);
    if (!/^0x[0-9a-f]{64}$/i.test(c.codeHashes?.[key] || '')) throw Error(`Missing ${key} runtime hash.`);
  }
  if ((BigInt(c.hook) & 0x3fffn) !== 0x20ccn) throw Error('Incorrect hook permission bits.');
  if (!/^0x[0-9a-f]{64}$/i.test(c.deploymentTransaction || '') || !Number.isSafeInteger(c.deploymentBlock) || c.deploymentBlock < 0) throw Error('Missing deployment receipt.');
  return true;
}
export function amount(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw Error('Enter a positive amount with at most 18 decimal places.');
  const n = parseUnits(value, 18);
  if (n <= 0n || n > (1n << 127n) - 1n) throw Error('Amount is outside the supported range.');
  return n;
}
export function minimumOutput(quoted, percent) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(percent)) throw Error('Slippage must have at most two decimal places.');
  const bps = parseUnits(percent, 2);
  if (bps < 1n || bps > 500n) throw Error('Choose slippage from 0.01% to 5%.');
  const minimum = quoted * (10000n - bps) / 10000n;
  if (minimum < 1n) throw Error('The output is too small to protect.');
  return minimum;
}
export function units(n, precision = 6) {
  if (n == null) return '—';
  const s = formatUnits(n, 18);
  const [whole, fraction = ''] = s.split('.');
  const trimmed = fraction.slice(0, precision).replace(/0+$/, '');
  if (BigInt(n) > 0n && whole === '0' && !trimmed) return `<0.${'0'.repeat(precision - 1)}1`;
  return `${BigInt(whole).toLocaleString('en-US')}${trimmed ? '.' + trimmed : ''}`;
}
export const short = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
export function duration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds)));
  return `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m ${s % 60}s`;
}
export function canDethrone(t) {
  return !!t && !sameAddress(t.king, ZeroAddress) && t.kingBalance < t.requiredBalance;
}
export function validQuote(q, {account, fingerprint, now = Date.now()}) {
  return !!q && sameAddress(q.account, account) && q.fingerprint === fingerprint && now >= q.createdAt && now - q.createdAt < 30000;
}
