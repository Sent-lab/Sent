# Graduation keeper runbook

The keeper finalises markets whose curve has closed. It is optional in the local
Docker stack and does not start during a plain `docker compose up`.

## Watch-only mode

With the normal local stack running, start the keeper profile without a key:

```sh
docker compose -f infra/docker/docker-compose.yml --profile keeper up -d keeper
```

The keeper reports pending markets and wait time through its operations metrics
on port 9105 inside the compose network; `/healthz` reports keeper-loop
liveness. It cannot send a transaction without `KEEPER_PRIVATE_KEY`.

## Automatic finalisation

The keeper processes every pending graduation it finds, sequentially. It is not
limited to one selected market. Before enabling transaction sending, an operator
must:

1. Confirm `RPC_URL`, `CHAIN_ID`, `FACTORY_ADDRESS` and
   `REWARD_VAULT_ADDRESS` point to the intended deployment.
2. Set `PLATFORM_ACCOUNTS.opsRelayer` to the intended public relayer address in
   the canonical chain config. The keeper checks that the injected key derives
   exactly that address on HyperEVM; it refuses sender mode if the config is
   unset or mismatched.
3. Confirm the relayer key is controlled by the operator, funded above
   `KEEPER_MIN_BALANCE_WEI`, and opted into HyperEVM's large block lane.
4. Provide the key through a secret manager or process environment. Do not put
   it in `.env`, `.env.example`, compose YAML or the repository.
5. Explicitly start the profile. This is the point at which the keeper may
   automatically submit `finalizeGraduation` transactions for all eligible
   pending markets.
6. Monitor the keeper's `keeper_can_send`, balance, pending count, failures and
   worst-wait metrics. Stop the profile if the deployment or relayer state is
   uncertain.

Each send is simulated first, uses an 8,000,000 gas limit and waits for a
successful receipt. The measured graduation cost is about 5.4M gas; the keeper
account still needs the chain's large-lane opt-in. The keeper cannot perform
that L1 opt-in itself. A reverted or failed finalisation remains pending and is
retried on a later sweep.

To stop automatic sending while keeping the rest of the stack up:

```sh
docker compose -f infra/docker/docker-compose.yml --profile keeper stop keeper
```

The compose profile is a local development topology, not a production
deployment. Production needs a separate secret-management, monitoring,
high-availability and incident-response plan.
