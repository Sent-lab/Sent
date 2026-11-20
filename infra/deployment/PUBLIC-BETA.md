# SENT public beta runbook

This is the low-cost, single-VM Docker topology in `infra/docker/docker-compose.public.yml`.
It is a deployment path for a limited beta, not a production availability promise. A
host can restart, and Oracle Always Free instances may be reclaimed. Do not use this
runbook to imply the on-chain launchpad is ready when the launch-readiness gates are
still open.

## Before provisioning a host

The application stack needs a Linux VM with Docker Engine and the Docker Compose
plugin, persistent disk, and inbound TCP ports 80 and 443 (plus UDP 443 for HTTP/3).
Create DNS A records for `WEB_DOMAIN`, `API_DOMAIN`, and `REALTIME_DOMAIN` pointing
to the VM. Caddy obtains and renews TLS certificates automatically. Do not expose
Postgres or the internal API/realtime ports directly to the internet.

The following must already be known and verified from chain before starting the
indexer:

- HyperEVM RPC endpoint and chain ID.
- Correct factory and reward-vault addresses.
- Earliest deployment block among the monitored contracts, for `START_BLOCK`.
- The deployment and launch-readiness gates in `docs/LAUNCH-READINESS-2026-11-18.md`.

Use an RPC provider with documented archive access and enough request quota for
both the indexer and API. Hyperliquid's official public RPC limits `eth_getLogs`
to 50 blocks per query and 100 JSON-RPC requests per minute per IP. The indexer
starts at the earliest deployment block; a full replay through that endpoint can
take many hours or days and shares the same per-IP quota with API traffic. The
public-beta environment template therefore leaves `RPC_URL` blank. Do not put
the official public RPC there for a production beta unless its replay time and
shared request load have been measured against the intended traffic.

The current production contracts have unresolved configuration and price-source
gates. SENT's MVP quote lane is WHYPE, with a Chainlink HYPE/USD reference source;
stock quote assets remain individually gated. A running web/API stack alone does
not make market creation, pricing, graduation, or rewards usable.

## Configure and start

Keep the runtime env file outside the repository and restrict it to the operator:

```bash
mkdir -p /opt/sent
install -m 600 infra/deployment/.env.public.example /opt/sent/.env
```

Set all required values in `/opt/sent/.env`. Generate `POSTGRES_PASSWORD` as 64
random hexadecimal characters; this value is embedded in the internal Postgres URL,
so URL-special characters are not supported. The public API stack does not accept
Chainlink credentials or serve signed reports. A separate private updater can be
added only after feed entitlement, subscription terms, and onchain operating costs
are confirmed. Keep `KEEPER_PRIVATE_KEY` empty for the initial deployment; the
keeper profile is opt-in and can sign transactions.

From the repository checkout, validate and start the stack:

```bash
docker compose --env-file /opt/sent/.env -f infra/docker/docker-compose.public.yml config --quiet
docker compose --env-file /opt/sent/.env -f infra/docker/docker-compose.public.yml up -d --build
docker compose --env-file /opt/sent/.env -f infra/docker/docker-compose.public.yml ps
```

The indexer applies database migrations at startup. The API health endpoint reports
whether indexed data is ready; Caddy waits for the API healthcheck before routing
public traffic. Check service logs and verify the indexed block is approaching the
current HyperEVM head before announcing the beta. `docker compose ps` also reports
liveness for the indexer, realtime gateway, worker and finalizer from their internal
operations endpoints; those monitoring ports are not published to the internet.

## Verify and operate

- Open `https://WEB_DOMAIN`, `https://API_DOMAIN/health`, and establish a WebSocket
  connection to `wss://REALTIME_DOMAIN`.
- Confirm API freshness is `LIVE` and the indexed block is advancing. Read API
  metrics from inside the container rather than through the public ingress:

  ```bash
  docker compose --env-file /opt/sent/.env -f infra/docker/docker-compose.public.yml \
    exec -T api wget -qO- http://127.0.0.1:8080/metrics
  ```

  Caddy returns 404 for the API metrics paths on the public hostname; the health
  endpoint remains available for external freshness checks.
- Create a verified database backup before updates and daily afterwards. Keep copies
  off the VM; the named Docker volume is not a backup. Follow
  `infra/deployment/RECOVERY.md` and rehearse a restore before relying on it.
- Keep the host patched and monitor disk, memory, container restarts, RPC errors,
  indexer lag, and TLS renewal. A free host can be reclaimed or lack regional
  capacity; restore onto a replacement VM from the off-host backup if needed.
- Do not enable `--profile keeper` until its dedicated operator account is
  provisioned, funded, configured for HyperEVM's large-block lane, and approved for
  transaction signing.

This runbook does not deploy contracts, apply production secrets, register an
xStock wrapper, configure an oracle, or send transactions. Those actions require
separate chain-specific verification and operator credentials.
