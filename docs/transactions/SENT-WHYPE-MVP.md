# SENT HYPE quote MVP Safe batch

Status: prepared, not submitted or executed.

Network: HyperEVM mainnet (chain ID 999)  
Safe: `0x791fb66Ac5ff91eE7D3F1697f85c4D8b646D1e22` (2-of-3)  
Batch manifest: `SENT-WHYPE-MVP.safe.json`

The batch deploys a permissionless, immutable 1:1 receipt token (`sWHYPE`) at
`0x132eA1dC4d56515af2cC4fAa6C50005aCA3b6805`. It wraps canonical WHYPE at
`0x5555555555555555555555555555555555555555`; the wrapper has no owner, fee,
pause, or upgrade path. The published initcode is 3,375 bytes and hashes to
`0x4ec9eb1ce47a81fc9e36a968381f13ad95f6f75bc750c10615f57fab5c749af3`.

The ten atomic Safe actions:

1. Deploy `sWHYPE` through the verified HyperEVM CREATE2 deployer.
2. Configure its HYPE/USD reference price to the already configured Chainlink
   proxy, with the same 24-hour freshness and USD bounds as WHYPE.
3. Register `sWHYPE` as an 18-decimal quote asset.
4. Set all eight registry gates true.
5. Enable `sWHYPE` for new launches.
6. Set launch fee to zero for the low-cost public MVP. Trading fees remain
   governed by the existing fee split.
7. Set Treasury Safe `0xEd7709178EF1De028E965B4107f56b5AecBE92A2` as reward guardian.
8. Add SENT Deployer `0x99922502a111538DFcE6a53b51BC94205FF56250` as an attestor.
9. Add Treasury owner `0xe7c76052DcAedaF7beba00F5B3c2a979407f0D4e` as the second
   attestor.
10. Set reward quorum to 2.

**Governance attestation:** action 4 also sets `legalReviewed=true`. This is an
on-chain governance assertion, not evidence that external counsel reviewed the
project. The Safe owners must review that assertion before signing. The HYPE
receipt design itself is non-rebasing and immediately redeemable 1:1, but this
repository does not contain a legal opinion.

The batch transfers no HYPE or other funds. It changes the quote asset, sets the
per-launch fee from 0.04 HYPE to zero, and configures the reward vault. Safe
owners still need to submit, sign and execute it. After execution, verify
deployed bytecode, registry enabled state, oracle readback and reward-vault
configuration before treating launch as ready.

Reward balances can accrue after a market launches, but public reward claims
still depend on the attestor distribution process. This repository computes
Merkle distributions; it does not hold attestor keys or automatically sign and
submit roots. Therefore launch/trade testing can be enabled by this batch, while
claimable rewards need the operator signing workflow to be run and verified.

The current repo has no public hosting deployment configured. A green local
build is not a public website deployment. The public-beta runbook also requires
an operator-provisioned host, domain records, and production RPC configuration.
