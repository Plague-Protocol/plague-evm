/**
 * zk.ts — ZK utilities for bot agents.
 *
 * Commitment computation:  poseidon2(role, secret) via @aztec/bb.js (WASM)
 *   This matches the Noir circuit exactly and has no version dependency on
 *   the nargo compiler.
 *
 * Witness + proof generation:  delegated to POST /api/prove/role-commitment
 *   The backend runs the correctly-pinned @noir-lang/noir_js (1.0.0-beta.20)
 *   and the native bb CLI binary, avoiding ACIR format mismatches.
 */
import { Barretenberg, Fr } from '@aztec/bb.js'
import { randomBytes } from 'crypto'

// ── Barretenberg singleton ────────────────────────────────────────────────────

let _bb: Barretenberg | null = null
async function getBB(): Promise<Barretenberg> {
  _bb ??= await Barretenberg.new({ threads: 1 })
  return _bb
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toField(v: bigint): `0x${string}` {
  return `0x${v.toString(16).padStart(64, '0')}`
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Random 248-bit secret — always below BN254 field modulus. */
export function randomSecret(): bigint {
  return BigInt('0x' + randomBytes(31).toString('hex'))
}

/**
 * Compute commitment = poseidon2_permutation([role, secret, 0, 0])[0]
 * using Barretenberg WASM — matches the Noir circuit exactly.
 */
export async function computeCommitment(role: bigint, secret: bigint): Promise<`0x${string}`> {
  const bb = await getBB()
  const res = await bb.poseidon2Permutation([new Fr(role), new Fr(secret), Fr.ZERO, Fr.ZERO])
  return toField(BigInt(res[0].toString()))
}

export interface RoleProofResult {
  commitment: `0x${string}`
  proofHex: `0x${string}`
}

/**
 * Full pipeline: compute commitment locally, then ask the backend to generate
 * witness + proof via /api/prove/role-commitment.
 *
 * role   — 0n = clean, 1n = patient_zero
 * secret — random 248-bit bigint from randomSecret()
 */
export async function generateRoleProof(
  role: 0n | 1n,
  secret: bigint,
  backendUrl: string,
): Promise<RoleProofResult> {
  const commitment = await computeCommitment(role, secret)

  const resp = await fetch(`${backendUrl}/api/prove/role-commitment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role:       toField(role),
      secret:     toField(secret),
      commitment,
    }),
  })

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string; detail?: string }
    throw new Error(body.detail ?? body.error ?? `Proof generation failed: HTTP ${resp.status}`)
  }

  const { proofHex } = (await resp.json()) as { proofHex: string }
  return {
    commitment,
    proofHex: (proofHex.startsWith('0x') ? proofHex : `0x${proofHex}`) as `0x${string}`,
  }
}

