# Deploying Plague on a single VPS (Tencent Lighthouse)

One box runs the whole backend stack: **backend + agents + Postgres + Redis**,
with **Caddy** terminating TLS for the public API. The frontend stays on Vercel
and calls `https://<API_DOMAIN>`.

```
Frontend (Vercel) ─► api.zplague.xyz ┌ backend ┐
                     (Caddy TLS)     │ agents  │  docker compose
                                     │ postgres│  on the VPS
                                     └ redis  ─┘
```

## 0. VPS sizing & region

- **Region:** a non-mainland region (**Hong Kong / Singapore / Silicon Valley**).
  Mainland instances hit GFW throttling reaching `forno.celo.org` and need ICP
  filing for web serving.
- **Size:** ≥ **4 GB RAM** (8 GB comfortable), 2–4 vCPU. `bb` ZK proving (both
  backend `/api/prove` and the agents) is memory-heavy, plus Postgres.
- **Firewall (Lighthouse):** open **22, 80, 443** only. Leave Postgres/Redis
  closed — they're never published to the host.

## 1. DNS

Create an **A record**: `api.zplague.xyz → <VPS public IP>`. Caddy provisions
the TLS cert automatically once 80/443 are reachable.

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

## 3. Clone + configure

```bash
sudo git clone <your-repo-url> /opt/plague
cd /opt/plague
cp deploy/.env.example deploy/.env
# edit deploy/.env — set API_DOMAIN, POSTGRES_PASSWORD, BACKEND_PRIVATE_KEY,
# BOT_RUNNER_SECRET, and BOT_PRIVATE_KEY_1..N
```

## 4. Launch

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

First boot: images build (the `bb` nightly download makes this a few minutes),
the backend runs `prisma migrate deploy` against the fresh Postgres, and the
agents run one-time ZK `setup` (persisted to the `agentdata` volume).

Check status / logs:

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f backend agents
```

## 5. Point the frontend at the VPS

Set the frontend's backend URL (Vercel env, e.g. `NEXT_PUBLIC_BACKEND_URL`) to
`https://api.zplague.xyz` and redeploy. Confirm `FRONTEND_URL` in `deploy/.env`
matches your frontend origin (CORS).

## 6. Backups

```bash
chmod +x deploy/pg-backup.sh
crontab -e
# 0 3 * * * /opt/plague/deploy/pg-backup.sh >> /var/log/plague-backup.log 2>&1
```

## Funding the bots (mainnet = real money)

- With `FEE_CURRENCY_ADDRESS` set to mainnet USDm, bots pay gas in USDm — fund
  each wallet with **USDm only**, enough for `STAKE_AMOUNT × expected games` +
  headroom. No CELO required.
- Keep `STAKE_AMOUNT` / `BOT_MAX_STAKE_WEI` low — bots lose real USDm to humans.
- Set `SELF_PLAY_DISABLED=true` if you don't want bots burning funds on
  maintenance games (they still join human rooms).

## Updating

```bash
cd /opt/plague && git pull
docker compose -f deploy/docker-compose.yml up -d --build
```
