**Day 8 (PRIMARY): one xStock found, by measurement.**

Not by guessing an address. HyperSwap's `NonfungiblePositionManager` was sampled for the token
pairs its 177,889 positions actually hold — 500 of the most recent positions, 433 unique
tokens — and the list was filtered for equity-shaped names. Exactly one hit:

```text
SP500 xStock   SPYx    0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48   18 dec
  totalSupply      14,496.95 units
  implementation   0xd865ce1b07540b5ede20e8298f48da69770fe22e
                   name() -> "Backed Token Implementation"  (EIP-1967 proxy)
  minter()         0x0a934bc9c64309c9654451f23d8331c2dad34c2a   (an EOA)
  owner()          0x49754062e35f7591b93cc4f9915965be89643a65   (a 171-byte contract)
  isPaused()       false

Wrapped SP500 xStock   wSPYx   0xe7e553cd128f0011777323a0b44a7b96ea1cb540   18 dec
  asset()          -> SPYx        an ERC-4626 wrapper over it
  convertToAssets(1e18) -> 1.0057145603      NOT one-to-one
```

The implementation is Backed Finance's own. This is the real issuer's code, not a lookalike.

**But canonicity for THIS chain is contradicted by the first party.** `xstocks.com` lists the
supported chains as Ethereum, Solana, BNB Smart Chain, Mantle, TON and Ink; `docs.xstocks.fi`
lists Ethereum, Solana, Arbitrum, Mantle, TON, Ink "and other EVM-compatible networks".
**Neither names HyperEVM.** So what is on HyperEVM is genuine Backed code at an address no
first party has published for this chain, which is precisely the situation §420 was written
against: *"Do not infer availability from the global xStocks product catalog."*

**And it is the only one.** 433 unique tokens across the sampled positions, and no NVDAx,
TSLAx, AAPLx or anything else. Whatever else is true, the HyperEVM xStock universe is one
asset with 14,497 units outstanding and a single thin pool — which is a product question
(§420's "at least one qualifying asset") before it is a verification one.

---

**Settled the same day, by this row's own verification method.**

Step 2 of `HOW TO VERIFY` says to read the linked ERC-20 "via the spot-deployer's finalized
`requestEvmContract` linkage". That linkage is readable on-chain: HyperEVM exposes HyperCore's
read precompiles, and `tokenInfo(uint32)` at `0x…080C` returns each HIP-1 token's `evmContract`
along with its `szDecimals`, `weiDecimals` and `evmExtraWeiDecimals`.

400 token indices were read. 119 have an EVM contract linked. **Every equity-shaped token has
`evmContract` = `address(0)`:**

```text
idx  name      szDec  weiDec  evmExtra  evmContract                    spot  spotPx
312  USPYX       2      8        0      0x0000…0000  NOT LINKED        189   620000000
319  UUUSPX      1      8        0      0x0000…0000  NOT LINKED        193     6468400
290  DNDX        2      8        0      0x0000…0000  NOT LINKED        (none)
```

`USPYX` is the S&P xStock, and it is live: it has a HyperCore spot market and a price. What it
does not have is an EVM representation linked by the official mechanism — **the linkage this
row's verification procedure depends on does not exist for any xStock.**

**So the answer to "which xStock assets have a canonical, verified ERC-20 representation on
HyperEVM" is: none.** Not "not yet found" — read, and absent.

That also settles the standing of the SPYx ERC-20 found earlier at
`0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48`. It is genuine Backed code, and it is **not** the
canonically linked representation, because there is no canonically linked representation. It is
a deployment that HyperCore does not point at and that no first party lists for this chain.

Three independent readings agree, which is why this is VERIFIED rather than PARTIAL:

| Source | Says |
|---|---|
| HyperCore `tokenInfo` (PRIMARY) | no xStock has a linked EVM contract |
| `xstocks.com` (OFFICIAL) | supported chains are Ethereum, Solana, BNB, Mantle, TON, Ink |
| `docs.xstocks.fi` (OFFICIAL) | Ethereum, Solana, Arbitrum, Mantle, TON, Ink |

**What this means for the product, stated plainly.** §2 LOCKS every market to an official xStock
quote asset and §420 forbids inferring availability from the global catalog. On the measurements
above there is no asset that qualifies today. That is a **product escalation**, not an
engineering gap — no amount of code closes it, and the registry correctly refuses to list
anything, which is the honest failure rather than a broken one.

**What remains genuinely unprovable from here:** whether Backed intends to link `USPYX` to an
EVM contract, or considers the unlinked SPYx deployment canonical anyway. Those need the issuer.
§421 forbids proceeding on a guess, and the allowlist stays empty until they answer.

---

