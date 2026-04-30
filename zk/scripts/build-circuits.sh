#!/usr/bin/env bash
# scripts/build-circuits.sh
# Compiles all Noir circuits and copies the resulting JSON artifacts to
# frontend/public/circuits/ so they can be loaded at runtime.
#
# Prerequisites:
#   - nargo (Noir toolchain): curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash && noirup
#
# Usage:
#   cd zk && bash scripts/build-circuits.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_CIRCUITS="$ZK_DIR/../frontend/public/circuits"

echo "==> Building Noir circuits in $ZK_DIR"

mkdir -p "$FRONTEND_CIRCUITS"

# ── compile all packages ─────────────────────────────────────────────────────
cd "$ZK_DIR"
nargo compile --workspace

# ── copy artifacts ───────────────────────────────────────────────────────────
CIRCUITS=(innocence_proof infection_proof role_commitment)

for circuit in "${CIRCUITS[@]}"; do
  SRC="$ZK_DIR/packages/$circuit/target/$circuit.json"
  if [[ -f "$SRC" ]]; then
    cp "$SRC" "$FRONTEND_CIRCUITS/$circuit.json"
    echo "  copied $circuit.json → frontend/public/circuits/"
  else
    echo "  WARNING: $SRC not found — compile may have failed for $circuit"
    exit 1
  fi
done

echo "==> Done. Circuit artifacts are in $FRONTEND_CIRCUITS"
