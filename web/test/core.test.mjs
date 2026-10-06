import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { amount, minimumOutput, units, duration, canDethrone, validQuote, validateConfig } from '../src/core.js';

const alice = '0x0000000000000000000000000000000000000001';
const bob = '0x0000000000000000000000000000000000000002';
test('amounts preserve wei precision and reject unsafe inputs', () => {
  assert.equal(amount('0.000000000000000001'), 1n);
  assert.equal(amount('1000000000'), 10n ** 27n);
  for (const v of ['0', '-1', '1e18', 'NaN', '0.0000000000000000001', '1,000', ' 1', '1.', '99999999999999999999999999999999999999999']) assert.throws(() => amount(v));
});
test('minimum output includes slippage and never silently disables protection', () => {
  assert.equal(minimumOutput(10000n, '0.5'), 9950n);
  assert.equal(minimumOutput(10000n, '5'), 9500n);
  for (const v of ['0', '5.01', '-1', '1e2', '0.001']) assert.throws(() => minimumOutput(10000n, v));
  assert.throws(() => minimumOutput(1n, '0.5'));
});
test('quote cannot survive input changes, wallet changes, expiry, or clock rollback', () => {
  const q = {account: alice, fingerprint: 'buy-1', createdAt: 1000};
  assert.equal(validQuote(q, {account: alice, fingerprint: 'buy-1', now: 2000}), true);
  for (const overrides of [{account: bob}, {fingerprint: 'sell-1'}, {now: 31000}, {now: 500}]) assert.equal(validQuote(q, {account: alice, fingerprint: 'buy-1', now: 2000, ...overrides}), false);
});
test('dethrone availability follows exact holdings including equality', () => {
  assert.equal(canDethrone({king: alice, kingBalance: 10n, requiredBalance: 11n}), true);
  assert.equal(canDethrone({king: alice, kingBalance: 11n, requiredBalance: 11n}), false);
  assert.equal(canDethrone({king: '0x' + '0'.repeat(40), kingBalance: 0n, requiredBalance: 11n}), false);
});
test('deployment is fail-closed and publishing requires actual addresses and receipt', async () => {
  const c = JSON.parse(await readFile(new URL('../public/imd-deployment.json', import.meta.url)));
  const pending = {...c, status: 'awaiting-deployment'};
  assert.equal(validateConfig(pending), false);
  assert.throws(() => validateConfig(pending, true), /verified deployment/);
  assert.throws(() => validateConfig({...pending, chainId: 8453}));
  assert.throws(() => validateConfig({...pending, poolFee: 3000}));
  assert.throws(() => validateConfig({...pending, status: 'live', hook: null}));
  assert.throws(() => validateConfig({...pending, rpcUrl: 'javascript:alert(1)'}));
});
test('display helpers do not turn sub-micro ETH into zero or lose large balances', () => {
  assert.equal(units(1n), '<0.000001');
  assert.equal(units(10n ** 27n), '1,000,000,000');
  assert.equal(duration(3661), '1h 1m 1s');
  assert.equal(duration(-1), '0h 0m 0s');
});
