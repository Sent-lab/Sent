# Stockback attestor handoff

The finalizer computes public reward datasets. It never holds attestor keys and
never submits commitments. This separation is intentional: a service that
decides an entitlement and signs it would make the quorum meaningless.

## Prepare a proposal

Each attestor must operate its own indexer and database. Configure that
operator's `DATABASE_URL` and `RPC_URL`, then run:

```sh
pnpm --filter @sent/finalizer proposal -- <token-address>
```

`REWARD_VAULT_ADDRESS` is optional; when absent, the configured HyperEVM vault
address is used. The tool:

- recomputes the latest stored dataset from that operator's finalized chain
  projection and refuses to continue if it differs from the stored root, hash,
  sequence or cumulative total;
- reads the market registration, reward asset, funding, quorum, active and
  pending commitments, governance, guardian and pause state from the live vault;
- constructs the EIP-712 payload and checks its digest against the vault's
  on-chain `hashCommitment` function;
- prints JSON to stdout. It does not read signing keys, produce signatures or
  send transactions.

The output is a proposal for review, not an approval. Before signing, the
attestor must confirm that its indexer is independently operated and caught up,
review chain events and exclusions, and compare the digest and commitment fields
with the other attestors. Distinct guardian and governance addresses do not
prove that their Safe owners are independent; that is a separate key-ceremony
check.

## Sign and submit

Use the `typedData` object with the attestor's assigned wallet or HSM. Keep that
key outside the API, finalizer and worker. Collect at least the on-chain quorum
of signatures, recover the signer addresses, confirm each is currently an
attestor, and sort signatures by strictly ascending signer address. The vault
rejects unsorted or duplicate signers.

After independent review, pass the collected 65-byte signatures as a JSON array
to the proposal command:

```sh
pnpm --filter @sent/finalizer proposal -- <token-address> --signatures '["0x...", "0x..."]'
```

The command recovers each signer, checks live attestor membership and ordering,
simulates `submitCommitment` against current chain state, then prints the vault
destination and calldata. Review those values in the wallet before submitting;
the simulation is a point-in-time check and does not reserve the pending slot.

Any account may then call `submitCommitment(commitment, signatures)`. Monitor the
pending root during the six-hour activation delay; the guardian is the emergency
cancel path. After the delay, anyone may call `activate(market)`. A proposal
tool for signature collection, key management and transaction submission is not
included, so these steps still require an operator-controlled process and
documented incident ownership.

## Operational limits

- The tool recomputes with SENT's canonical Stockback implementation. It is not
  a second, independently authored reward algorithm.
- Independent operators must provide separate databases and independently
  verify indexer configuration, chain coverage, finality and excluded addresses.
- No signer keys, signatures, Safe actions, or transaction submission are
  created by this repository's proposal command. It only accepts signatures
  provided by the operator and emits unsigned calldata after simulation.
- Mainnet rewards remain unavailable until the actual guardian, attestor set,
  quorum, RPC/database services and operator key ceremony are configured and
  verified.
