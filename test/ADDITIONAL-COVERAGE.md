# Additional KING test coverage

These tests extend the existing launch, fee, throne, security, fuzz and conservation suites.
They run offline against the vendored Uniswap v4 PoolManager and the unchanged project contracts.
The supplied Pashov fizz, Trail of Bits property-testing and eth-testing references informed the
property selection; the test code is original and uses the existing KingBase fixture.

## Failure atomicity

`KingRouter.Atomicity.t.sol` checks all four order deadlines, all zero-amount cases, missing
allowances, insufficient token balances, exact-output input caps, and slippage after settlement.
Before and after failed calls it compares game/history state, credits, claims, wallet/manager/router
balances, allowance, price and LP fee growth. It also verifies that PoolManager deltas settle.
The takeover/slippage property runs 1,000 fuzz cases and follows the rejected order with a valid
takeover. A rejecting ETH recipient must preserve its income and claims, then receive exactly its
credit when it accepts ETH; a second same-timestamp claim must fail.

## Liquidity and fee-claim invariants

`KingHook.LiquidityInvariant.t.sol` uses three traders and a liquidity provider, 256 random
sequences of 64 calls, and `fail-on-revert = true`. Actions include buys, sells, transfers,
time advances, claims, eligible dethrones, additions/removals of liquidity and LP fee collection.
No balances are injected after setup. Selectors explicitly exclude the terminal exit helper.

The properties assert:

- ETH and the complete fixed KING supply are conserved across tracked wallets and contracts.
- Hook claims equal the throne pool, provisional income and all pending credits.
- Collected hook fees equal outstanding claims plus payouts, and the manager backs every claim.
- Plain transfers and liquidity operations do not execute hook game/accounting logic.
- Router and hook settlement leaves no open PoolManager deltas or stranded order funds.
- The actual LP position matches the handler's independent liquidity counter.

Every sequence ends by withdrawing the whole LP position, then paying all claimable credits.
Remaining manager funds must back the hook claims; unassigned rounding residue is bounded by
100,000 units per currency over at most 64 calls. A deterministic scenario requires successful
buys, a sell, liquidity changes and payouts, independently of random action selection.

The vendored LP test router assumes an addition's net delta is negative. The handler collects
accrued LP fees before adding, so a fee larger than a small deposit cannot trip that fixture-only
assumption. Sells retain partial fills and refunds; only an already-reached maximum price is
excluded, where v4 explicitly refuses another sell until a buy moves the price.

## Reproduction and limits

Run `forge build` and `forge test`. To keep generated files inside the task's writable test tree:

```sh
forge build --out test/scratch/out --cache-path test/scratch/cache
forge test --out test/scratch/out --cache-path test/scratch/cache
```

A separate exact-output underfill defect is reported in `.imd-findings.json`. Its embedded
self-contained Foundry proof was run and failed on the existing contracts; it is intentionally
not a passing regression that blesses partial exact-output execution. Save its `proof` string
under `test/scratch/ExactOutputProof.t.sol` and run the report's reproduction command.

No Robinhood Chain deployment or frontend publishing was performed in this tests-only assignment.
The inherited fork tests target Base and may skip without network access; they do not establish
Robinhood Chain compatibility. The new coverage requires neither an RPC nor environment changes.

Validation on this tree: `forge build` succeeded (existing source/test lint warnings remain).
The full `forge test` run passed 169 tests across 15 suites, with zero failures or skips.
The new invariant completed 256 sequences / 16,384 calls with zero handler reverts. The separate
underfill proof failed with 29,929,571,122,926,013,069 received units versus 1,000,000,000,000,000,000,000
requested units, as recorded in the findings report.
