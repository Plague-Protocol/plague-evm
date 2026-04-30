# Contributing to Plague 🦠

First off — thank you. Plague is designed to be **90% community-built**. This document is your complete guide to contributing effectively.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Before You Start](#before-you-start)
3. [Picking an Issue](#picking-an-issue)
4. [Development Setup](#development-setup)
5. [Branch & Commit Conventions](#branch--commit-conventions)
6. [Pull Request Process](#pull-request-process)
7. [Code Style](#code-style)
8. [Issue Labels Explained](#issue-labels-explained)
9. [Getting Help](#getting-help)

---

## Philosophy

Every issue in this repo is written so that a contributor can pick it up **without needing to ask questions first**. Each issue includes:
- Exact files to modify
- What the implementation should do
- Acceptance criteria to self-check your work
- Links to relevant docs/examples

If an issue is unclear, please **comment on it** rather than opening a new one. We improve issues based on feedback.

---

## Before You Start

1. **Check if an issue exists** for what you want to work on. If not, open one before writing code.
2. **Comment on the issue** to claim it. This prevents duplicate work.
3. **Do not submit a PR for an unclaimed issue** — it may be rejected if someone else is already working on it.
4. One issue per PR. Keep PRs focused.

---

## Picking an Issue

**New to the codebase?** Start with issues labelled [`good first issue`](../../issues?q=label%3A"good+first+issue") + [`easy`](../../issues?q=label%3Aeasy).

**Comfortable with the stack?** Filter by your area:

| Your skill | Label to filter |
|---|---|
| React / Next.js / Tailwind | `frontend` |
| Rust / Soroban | `contract` |
| Node.js / Socket.io | `backend` |
| Noir / ZK circuits | `zk` |
| Tests / QA | `testing` |
| Docs / DX | `documentation` |

---

## Development Setup

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/plague
cd plague

# 2. Add upstream remote
git remote add upstream https://github.com/ORIGINAL_OWNER/plague

# 3. Install dependencies
npm install

# 4. Copy env files
cp .env.example backend/.env
cp .env.example frontend/.env.local

# 5. Start dev servers
npm run dev
# Frontend: http://localhost:3000
# Backend:  http://localhost:4000

# 6. For contract work
cd contracts
cargo build --target wasm32-unknown-unknown --release
cargo test

# 7. For ZK circuit work
cd zk/circuits
nargo compile
nargo test
```

---

## Branch & Commit Conventions

### Branch naming

```
feat/issue-<number>-short-description
fix/issue-<number>-short-description
docs/issue-<number>-short-description
test/issue-<number>-short-description
chore/issue-<number>-short-description
```

Examples:
```
feat/issue-5-lobby-room-list
fix/issue-12-vote-panel-overflow
docs/issue-50-zk-setup-guide
```

### Commit messages (Conventional Commits)

```
feat(frontend): add room list component (#5)
fix(contract): prevent double vote in same round (#44)
test(backend): add socket handler unit tests (#20)
docs(zk): add circuit setup instructions (#50)
chore: update dependencies
```

---

## Pull Request Process

1. **Keep the PR focused** — one issue per PR.
2. **Fill out the PR template** completely.
3. **Self-review your diff** before requesting review. Check for console.logs, commented-out code, and TODO comments that weren't in the original file.
4. **All tests must pass** — `npm test` must exit 0.
5. **No new TypeScript errors** — `tsc --noEmit` must pass.
6. **Contracts: include tests** — Any contract change needs corresponding test coverage in `contracts/test/`.
7. **Screenshots for UI changes** — Attach a before/after screenshot in your PR description.

PRs that don't follow these guidelines will be asked to revise before review.

---

## Code Style

### TypeScript / React
- Strict TypeScript — no `any` types
- Functional components only — no class components
- Hooks for all state logic — no Redux
- File naming: `PascalCase` for components, `camelCase` for hooks/utils

### Rust / Soroban
- Run `cargo fmt` before committing
- Run `cargo clippy` and address all warnings
- Every public function needs a doc comment

### Noir (ZK circuits)
- Comment every constraint explaining *why* it's needed
- Every circuit must have passing `nargo test` coverage

### CSS / Tailwind
- Use the design tokens defined in `tailwind.config.js`
- Neobrutalist style: use `.btn-brutal`, `.card-brutal`, `.input-brutal` classes
- No inline styles — use Tailwind utilities

---

## Issue Labels Explained

| Label | Meaning |
|---|---|
| `frontend` | React/Next.js/Tailwind/UI work |
| `backend` | Node.js/Express/Socket.io work |
| `contract` | Soroban/Rust smart contract work |
| `zk` | Noir circuit / ZK proof work |
| `testing` | Unit, integration, or e2e tests |
| `documentation` | README, guides, inline docs |
| `good first issue` | Well-scoped, no deep context required |
| `easy` | < 2 hours estimated |
| `medium` | 2–8 hours estimated |
| `hard` | 8+ hours, deep domain knowledge needed |
| `bug` | Something is broken |
| `ui` | Visual/design change |
| `performance` | Speed/optimisation improvement |
| `security` | Security-sensitive — extra review required |
| `help wanted` | Maintainer needs input from community |

---

## Getting Help

- **GitHub Discussions** — for design questions, architecture discussions, or "how should I approach this?"
- **Comment on the issue** — for questions specific to an issue
- **Telegram** — [@andyjackson0328](https://t.me/andyjackson0328) for quick questions

We aim to respond to all comments within 48 hours.

---

Thank you for building Plague with us. 🦠
