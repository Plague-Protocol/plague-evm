# ── Plague Backend — production image ────────────────────────────────────────
#
# WHY we install the native `bb` binary:
#   @aztec/bb.js (npm, all versions) only contains BincodeDeserializer in its
#   WASM, but Nargo ≥ 1.0.0-beta.20 compiles circuits to MsgPackCompact ACIR.
#   Proof generation is therefore delegated to the native `bb` CLI which fully
#   supports MsgPack.
#
# Build context: repo root  (docker build -f backend/Dockerfile .)
#   Railway → set "Root Directory" to / and "Dockerfile Path" to backend/Dockerfile
#
# Required env vars in Railway (beyond what's in Dockerfile ENV):
#   NODE_ENV, PORT, DATABASE_URL, REDIS_URL, CELO_RPC_URL,
#   CONTRACT_ADDRESS, BACKEND_PRIVATE_KEY, PLATFORM_RECEIVER, NETWORK
#   BB_BINARY_PATH is already set to /usr/local/bin/bb by this Dockerfile.

FROM node:20-bookworm-slim

# bb is a native C++ binary — needs curl for bbup install + runtime libs
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    libgomp1 \
  && rm -rf /var/lib/apt/lists/*

# ── Install bb binary ──────────────────────────────────────────────────────
# Version MUST match the one used to generate the VK for the deployed
# RoleCommitmentVerifier / InnocenceProofVerifier contracts on-chain.
# Update this when recompiling circuits and redeploying verifier contracts.
ENV BB_VERSION=5.0.0-nightly.20260324

RUN curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash \
  && /root/.bb/bbup -v ${BB_VERSION} \
  && /root/.bb/bb --version \
  && cp /root/.bb/bb /usr/local/bin/bb

# ── Copy app ───────────────────────────────────────────────────────────────
WORKDIR /app

# Monorepo workspace manifests (install deps from lockfile — node_modules is
# gitignored so we never COPY it from the build context)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install backend workspace deps only (skip frontend to keep image lean).
# --include=dev needed for typescript/prisma at build time; pruned below.
RUN npm ci --workspace=backend --include-workspace-root --include=dev

# Prisma 6.x requires `tsx` at runtime to load prisma.config.ts (TypeScript).
# The pre-deploy migration step (`npx prisma migrate deploy`) runs inside the
# image and will crash without it — install globally so it's on PATH.
RUN npm install -g tsx

# Backend source + build
COPY backend/tsconfig.json ./backend/
COPY backend/prisma.config.ts ./backend/
COPY backend/prisma ./backend/prisma
COPY backend/src ./backend/src

RUN npx prisma generate --schema backend/prisma/schema.prisma \
  && cd backend && node ../node_modules/typescript/lib/tsc.js

# ZK circuit artifacts (compiled by `nargo compile`, committed to repo)
# The prove route resolves: __dirname/../../../zk/target → /app/zk/target
COPY zk/target ./zk/target

# ── Runtime config ─────────────────────────────────────────────────────────
ENV BB_BINARY_PATH=/usr/local/bin/bb
ENV NODE_ENV=production

EXPOSE 4000

CMD ["node", "backend/dist/index.js"]

