# Compiled Noir Circuit Artifacts

This directory holds the JSON artifacts produced by `nargo compile`.

These files are **required** for ZK proof generation in the browser.
They are not committed to git — generate them locally:

```bash
cd zk && bash scripts/build-circuits.sh
```

Prerequisites: Install the Noir toolchain first:
```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup
```

Expected files after build:
- `innocence_proof.json`
- `infection_proof.json`
- `role_commitment.json`
