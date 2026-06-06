# ── Plague Agent Runner — production image ────────────────────────────────────
#
# Runs the autonomous bot wallets that play Zombie Plague 24/7.
#
# WHY we install the native `bb` binary:
#   ZK witness generation uses @noir-lang/noir_js, but proof generation is
#   delegated to the native `bb` CLI (same reason as the backend image —
#   @aztec/bb.js npm WASM doesn't handle MsgPackCompact ACIR from Nargo ≥ 1.0).
#
# Build context: repo root  (docker build -f agents/Dockerfile .)
#   Railway → set "Root Directory" to / and "Dockerfile Path" to agents/Dockerfile
#
# Required env vars in Railway:
#   NETWORK, CELO_RPC_URL, CONTRACT_ADDRESS, USDM_ADDRESS, BACKEND_URL
#   BOT_PRIVATE_KEY_1 .. BOT_PRIVATE_KEY_N
#   FEE_CURRENCY_ADDRESS  (optional — pay gas in USDm on mainnet)
#   BB_BINARY_PATH is already set to /usr/local/bin/bb by this Dockerfile.
#
# Two-step startup:
#   1. If data/bot-proofs.json is missing, run `setup` automatically.
#   2. Then run `runner` forever.
#   Proofs are persisted on a Railway Volume mounted at /app/agents/data.

FROM node:20-bookworm-slim

# bb is a native C++ binary — needs curl + runtime libs
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    libgomp1 \
  && rm -rf /var/lib/apt/lists/*

# ── Install bb binary ──────────────────────────────────────────────────────
# Version MUST match the one used by the backend and the deployed verifier contracts.
ENV BB_VERSION=5.0.0-nightly.20260324

RUN curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash \
  && /root/.bb/bbup -v ${BB_VERSION} \
  && /root/.bb/bb --version \
  && cp /root/.bb/bb /usr/local/bin/bb

# ── Copy app ───────────────────────────────────────────────────────────────
WORKDIR /app

# Monorepo workspace manifests
COPY package.json package-lock.json ./
COPY agents/package.json ./agents/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install agents deps only (skip backend/frontend to keep image lean)
RUN npm ci --workspace=agents --include-workspace-root

# Agent source
COPY agents/tsconfig.json ./agents/
COPY agents/src ./agents/src

# ZK circuit artifacts (needed for witness generation)
COPY zk/target ./zk/target

# ── Runtime config ─────────────────────────────────────────────────────────
ENV BB_BINARY_PATH=/usr/local/bin/bb
ENV NODE_ENV=production

# data/ is expected to be a Railway Volume so proofs survive restarts.
# Create the directory so setup can write to it if no volume is attached.
RUN mkdir -p /app/agents/data

# Entrypoint: auto-run setup if proofs are missing, then start runner
COPY agents/entrypoint.sh ./agents/entrypoint.sh
RUN chmod +x /app/agents/entrypoint.sh

CMD ["/app/agents/entrypoint.sh"]
