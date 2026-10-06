# Launch 814 fee-policy redeployment

Source: https://github.com/identity-md-launches/launch-814-custom-token-king-hill,
commit 4592f674017e22524803e7a9f93e41f81519d745. SOURCE.json records the import.
All dependencies are ordinary vendored files; no install, submodule, CDN, or network access is
needed to compile the delivered contracts or build the frontend. The original compiler and
remappings are unchanged: Solidity 0.8.26, Cancun, optimizer 200, no metadata hash, no FFI or
filesystem cheatcode permissions.

## Bounded change

The only production Solidity change is the fee guard in KingHook.beforeInitialize: it now
requires 12_500, instead of accepting 500, 3000, and 10_000. The manifest, reference
deployment script and test pool fixtures use 12500. Initialization still requires the
PoolManager, native ETH/KING, and a previously uninitialized hook. The callback selector,
permissions (0x20CC), team address, token, router, game logic and all economic constants stay
unchanged. The old tiers, zero and the dynamic flag fail. New initialization tests check the
selector, preserved hook fee, rejection without state mutation, and subsequent valid initialization.

The factory pool fee is **1.25%**, additional to the hook's **25% → 2.5%** ETH fee. No LP fee
override is introduced. Fee settlement still mints ERC-6909 claims during swaps and redeems on
claim, so a KING-only launch needs no manager ETH prefunding. A payee rejecting ETH breaks only
its own claim. No permission or payout path changed.

The supplied brief's simplified game summary differs from the reviewed source in two respects:
five-minute income vesting, and limits on identifying a king's sales through foreign routers.
The request to retain every reviewed rule/parameter takes precedence here. Both behaviors are
retained, regression-tested, and explained in the frontend. A short reign forfeits provisional
income; a holding failure forfeits the unverified interval; vested booked credit survives.

## Deployment parameters and status

| Parameter | Value |
| --- | --- |
| Target | Robinhood Chain mainnet, chain ID 4663 |
| PoolManager | Supplied by the launch factory as $poolManager; no guessed address |
| Token | Factory deploys KingToken, passes $token to KingHook |
| Pool | Native ETH / KING, fee 12500, tick spacing 60 |
| Initial sqrt price | 792281625142643375935439503360000 |
| Initial market cap | 10 ETH across the full billion-token supply |
| Liquidity | 900,000,000 KING, single-sided; range [-887220, 184200] in rehearsals |
| Requester allocation | 0%; pool allocation 9000 basis points |
| Remaining 10% | Existing network contributor allocation policy |
| Hook fee team | 0x39E3414e7a43DE41675e9bEC52F7C9F6ae489CB6 |

Robinhood's [official network configuration](https://docs.robinhood.com/chain/connecting/)
lists the public RPC and explorer used in web/public/imd-deployment.json. A read-only RPC
check returned eth_chainId = 0x1237 on 2026-10-06. Chain timing uses timestamps, never block
counts. Cancun/transient-storage execution and the selected factory/PoolManager must be
rehearsed together on Robinhood before release.

At implementation time, [launch 814's public record](https://api.imd.fun/launches/6cb380ee-cdff-4c30-820e-802522df242c)
was parked, with no deployment artifacts, economics.poolBps = 9000, and policy version 30.
The [policy endpoint](https://api.imd.fun/launch/policies) lists feeTiers: [12500] for that
Robinhood hook policy. The manifest format leaves chain and allocation selection to the
launch request/factory; they are not invented manifest keys.

**No Robinhood transaction was broadcast and no public site was published in this workspace.**
The assignment supplied no chain deployment configuration, transaction signer, deployment
receipt, IPFS pinning account, or paired publisher signer. The available tools have no launch
or publishing connector. This is a concrete external dependency, not a request for renewed
permission. No keys were searched for or exposed. web/dist/index.html is delivered with an
explicit awaiting-deployment state, null contract addresses and disabled transaction actions.
It contains no fabricated balances, deployment hashes, CID, or public URL.

## Release responsibilities

1. The network deployer must submit this source to the existing factory flow on chain 4663,
   with pool allocation 9000 bps, requester 0, initial market cap 10 ETH. Rebuild/attest this
   revision; a changed creation code needs a newly mined CREATE2 salt. Do not reuse 814's old
   attestation or predicted hook address. Deploy token, hook and initialize atomically; seed
   the KING-only position. The preserved reference script is a rehearsal, not the factory's
   allocation/fee-distribution implementation.
2. Record the successful receipt, token/hook/router/PoolManager addresses and pool ID. Verify
   deployed bytecode against the new attestation, including immutable constructor values;
   verify source on the Robinhood explorer. Exercise buys, sells, must-take failure/success,
   vesting, claims, and dethroning on the actual target manager.
3. Bind the frontend to that **attested** hook using web/scripts/configure.mjs. It verifies
   network, code presence, initialization event/receipt, token metadata, pool key, immutable
   relationships, fee and team wallet, then pins runtime hashes. This read-only helper does
   not replace the factory's bytecode attestation or allocation checks.
4. Build the release with node web/scripts/build.mjs --release. Publish **web/dist/** as the
   site root (so dist/index.html is relative to the separate web/ project). Pin all files
   to IPFS and retain the pin. The [IMD sites API](https://imd.fun/docs/) requires
   a paired device signature for POST /sites/publish; the paired contributor/publisher must
   submit it and record the resulting CID, site ID and actual label.sites.imd.fun URL.
5. Fetch the published site and config through the public gateway, compare bytes, and exercise
   the connected-wallet flow. Record a real publication receipt; a local build is not a pin.

The team claims its own 8% credit. Users claim their own vested income. Anyone can call
dethrone() on a holding shortfall; no keeper is required and no bounty is provided. Hosting
operators maintain RPC availability, pins, and the site label. Nobody can pause, upgrade,
change parameters, or recover unsolicited token deposits from the immutable contracts.

## Checks and scope of review

The required checks are forge build, forge test, and forge fmt --check. All source
tests are retained, including four swap modes, partial fills, fee splitting, fresh-manager
buys, reentrancy, conservation, fuzzing and invariants. The full suite uses the new 12500 fee.
The legacy Base forks are regression evidence only; offline they explicitly skip if unreachable.
No test reads or sets environment variables. The script's existing run() accepts deployment
environment configuration; tests call its parameterized function.

The web unit tests cover input precision, minimum outputs, quote expiry and
identity changes, holdings checks, formatting and fail-closed deployment configuration.
The web integration test starts local Anvil and exercises the real frontend client against
the real contracts. Its aggregate fixture compiles without Foundry dynamic test linking in
test/scratch/, and lifts only the aggregate test harness size limit; production runtime sizes
remain tested by the Solidity suite. Browser checks use that same local fixture.

Historical independent agent review is preserved in docs/REVISION.md. This revision's
bounded self-review checked unchanged authentication and ETH delta paths, fee-policy acceptance,
frontend quote/chain/account binding, exact approvals, and no dynamic address override from a URL.
No new independent audit, Slither/Mythril run, formal proof, or Robinhood fork result is claimed.
Tests passing are not a human security audit.

## Recorded local verification (2026-10-06)

- forge build: success with pinned Solidity 0.8.26. Existing Foundry lint warnings remain;
  this is not a warning-free static-analysis claim.
- forge test: 158 passed, 0 failed, 0 skipped, across 13 suites, including the retained Base forks.
- forge fmt --check: success.
- python3 script/check_source.py: success; only the intended production guard changed.
- node --test web/test/*.test.mjs: 6 passed, 0 failed.
- node web/test/integration.mjs: success for actual router simulation and transactions against
  a locally deployed pool, including the first buy with zero manager ETH.
- Browser on local Anvil: buys/must-take, wallet rejection, changed quote input, vesting/claim,
  holding shortfall/dethrone, approvals/sells, account/network switching and history passed.
  Desktop (1440 px) and mobile (390 px) pending-deployment pages had no horizontal overflow
  or JavaScript errors. This is a local browser test, not a public-site test.
- Offline-capable static build succeeds; the release build correctly rejects the pending config.
  The delivered dist files were compared byte-for-byte with their public/src inputs.

Remote acceptance remains open: Robinhood factory deployment, target-chain rehearsal/source
verification, binding actual addresses, IPFS pinning, IMD site publication, and public-URL checks.
