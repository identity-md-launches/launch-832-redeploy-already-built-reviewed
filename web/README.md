# KING frontend

Static ES modules, CSS, SVG and a locally vendored ethers 6.16.0 browser build (MIT, hashes in
vendor/provenance.json). No npm install, build framework, CDN, remote font or runtime backend
is required. Node 22 builds/tests it offline. The dist/ directory is delivered as ordinary files.

From repository root:

~~~sh
forge build
node --test web/test/*.test.mjs
node web/test/integration.mjs
node web/scripts/build.mjs
python3 -m http.server 8080 --directory web/dist
~~~

Use http://localhost:8080. ES modules/fetch need HTTP; opening index.html with file://
is not supported. The default build explicitly says awaiting deployment and disables wallet
actions. The local Anvil integration uses test accounts and creates no mainnet transaction.
It uses only Node built-ins, vendored ethers and the Foundry toolchain.

After the network has deployed and independently attested this revision:

~~~sh
node web/scripts/configure.mjs ATTESTED_HOOK_ADDRESS DEPLOYMENT_TRANSACTION_HASH
node web/scripts/build.mjs --release
~~~

The optional third argument is a public HTTPS RPC URL; never embed a credential-bearing URL.
The configure script reads onchain data and writes public/imd-deployment.json; it never signs.
It derives token/router/PoolManager from the hook, checks receipt/initialization and immutable
relationships, and records code hashes. Factory attestation establishes that the provided hook
is the reviewed implementation. The release build refuses missing addresses, hashes, or
receipt. Rebuild ABIs from the corresponding Foundry artifacts if the public interface changes;
the build checks ABI equality when artifacts are present.

Serve/pin the contents of **web/dist/** as the site root. All asset URLs are relative and routes
use fragments (#throne, #trade, #claim, #about), so both IPFS subpaths and IMD site domains
work without server rewrites. Browser wallets require HTTPS for the public deployment.
Publication still needs the network publisher's IPFS pin and paired device signature; see
[the deployment handoff](../docs/REDEPLOYMENT.md). No public URL or CID has been assigned here.

The app reads a consistent block snapshot every 12 seconds without requiring a wallet. History
is paginated in ten-reign pages directly from the hook, with no indexer. It checks chain ID,
code hashes, initialized pool, token metadata, team, and hook/router relationships before
enabling actions. Address links come only from the release configuration, never query strings.

Wallet flow supports injected EIP-1193 wallets (including wallet browsers), switching/adding
Robinhood Chain, account/network changes, rejected requests, simulation failures, pending and
replacement receipts, and success/failure feedback. There is no WalletConnect dependency.
On network/read failure, actions disable; stale readings are labeled after 30 seconds.

Buys use buyExactIn with the explicit must-take flag. Sells use sellExactIn, after a separate
approval of exactly the entered amount. A preview simulates the actual router call from the
connected wallet, including fees/price impact. The quote expires after 30 seconds and is
invalidated by input, direction, flag or account changes. Minimum output defaults to 0.5%
slippage (allowed 0.01–5%), uses integer wei arithmetic, and must be positive. A five-minute
deadline comes from the chain's latest timestamp. Final execution is simulated again without
loosening the quoted minimum. Transaction requests carry chain ID 4663. Claims and dethroning
are also simulated before the wallet request.

The website describes the source's five-minute vesting and foreign-router holding limitations.
Its approximate clocks advance at most 30 seconds past the last chain snapshot; displayed income
and prices remain actual contract reads, never invented projections. The per-hour figure is
the hook's incomePerHour() view; new fees and the absence of a king affect realized income.

The required notice is visible on every page:
“Made by agents. Not audited by humans. Trade at your own risk.”
