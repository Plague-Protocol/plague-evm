// ZK proof utilities — Noir circuits via @noir-lang/noir_js + barretenberg
// Circuits: /zk/circuits/  |  Compiled artifacts: /public/circuits/
//
// Circuits must be compiled before proof generation works:
//   cd zk && nargo compile        (produces target/*.json per circuit)
//   cp target/*.json ../frontend/public/circuits/
//
// Role encoding:  0 = clean,  1 = patient_zero,  2 = infected

import { Noir } from '@noir-lang/noir_js'
import { UltraHonkBackend } from '@noir-lang/backend_barretenberg'
import { Barretenberg, Fr } from '@aztec/bb.js'

// ─── Backend prove helper ───────────────────────────────────────────────────
// @aztec/bb.js (all npm versions) only contains BincodeDeserializer in its
// WASM, but Nargo ≥ 1.0.0-beta.20 produces MsgPackCompact ACIR bytecode.
// Proof generation is therefore delegated to the backend where the native
// `bb` CLI (installed by Nargo) handles MsgPack correctly.

async function backendProve(
  circuitId: 'role_commitment' | 'innocence_proof' | 'infection_proof',
  witness: Uint8Array
): Promise<Uint8Array> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000'

  // Encode gzip-compressed witness bytes as base64 for transport
  let binary = ''
  for (const byte of witness) binary += String.fromCodePoint(byte)
  const witnessBase64 = btoa(binary)

  const resp = await fetch(`${backendUrl}/api/prove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ circuitId, witnessBase64 }),
  })

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}))
    const b = body as { error?: string; detail?: string }
    throw new Error(b.detail || b.error || `Proof generation failed (${resp.status})`)
  }

  const { proofHex } = (await resp.json()) as { proofHex: string }
  const hex = proofHex.startsWith('0x') ? proofHex.slice(2) : proofHex
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}
import type { ZKProof, RoleCommitment } from '@/types/game'

// ─── Constants ─────────────────────────────────────────────────────────────

const ROLE_CLEAN = 0n
const ROLE_PATIENT_ZERO = 1n

// ─── Barretenberg Poseidon2 helpers ─────────────────────────────────────────
// These functions use the exact same Poseidon2 permutation as the Noir circuits.
// The circuits call:  std::hash::poseidon2_permutation([a, b, 0, 0])[0]
// Here we call:       bb.poseidon2Permutation([Fr(a), Fr(b), Fr.ZERO, Fr.ZERO])[0]

let _bbPromise: Promise<Barretenberg> | null = null

function getBB(): Promise<Barretenberg> {
  _bbPromise ??= Barretenberg.new()
  return _bbPromise
}

/** hash2(a, b) = poseidon2_permutation([a, b, 0, 0])[0] */
async function hash2(a: bigint, b: bigint): Promise<bigint> {
  const bb = await getBB()
  const res = await bb.poseidon2Permutation([new Fr(a), new Fr(b), Fr.ZERO, Fr.ZERO])
  return BigInt(res[0].toString())
}

/** hash3(a, b, c) = poseidon2_permutation([a, b, c, 0])[0] */
async function hash3(a: bigint, b: bigint, c: bigint): Promise<bigint> {
  const bb = await getBB()
  const res = await bb.poseidon2Permutation([new Fr(a), new Fr(b), new Fr(c), Fr.ZERO])
  return BigInt(res[0].toString())
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Convert a hex/decimal string or bigint to a Field-compatible hex string.
 */
function toField(value: string | bigint | number): string {
  const n = typeof value === 'bigint' ? value : BigInt(value)
  return `0x${n.toString(16).padStart(64, '0')}`
}

/**
 * Deterministic secret: derive a 32-byte bigint from a player-provided
 * passphrase (or random bytes). Uses SubtleCrypto SHA-256 so it is always
 * consistent for the same input string.
 */
export async function deriveSecret(passphrase: string): Promise<bigint> {
  const encoder = new TextEncoder()
  const data = encoder.encode(passphrase)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  // Reduce modulo BN254 scalar field to ensure it's a valid Field element
  const BN254_R =
    21888242871839275222246405745257275088548364400416034343698204186575808495617n
  return BigInt('0x' + hex) % BN254_R
}

/**
 * Load a compiled Noir circuit JSON from /public/circuits/<name>.json.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCircuit(name: string): Promise<any> {
  const url = `/circuits/${name}.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `Circuit artifact not found: ${url}. ` +
        `Run 'nargo compile' in the /zk directory and copy the output to /frontend/public/circuits/.`
    )
  }
  return res.json()
}

// ─── Role commitment ────────────────────────────────────────────────────────

/**
 * Generates Poseidon2(role, secret) on the client.
 * This value is submitted on-chain at game start and later used to anchor
 * ZK proofs without revealing the role.
 *
 * Uses Barretenberg poseidon2_permutation — matches the Noir circuit exactly.
 */
export async function generateRoleCommitment(
  role: 'patient_zero' | 'clean',
  secret: bigint
): Promise<RoleCommitment> {
  const roleNum = role === 'patient_zero' ? ROLE_PATIENT_ZERO : ROLE_CLEAN
  const commitment = await hash2(roleNum, secret)
  return {
    commitment: toField(commitment),
    role,
    secret: toField(secret),
  } as RoleCommitment
}

// ─── Innocence proof ────────────────────────────────────────────────────────

/**
 * Generates a ZK proof that the caller is a CLEAN player.
 * Only valid during the voting tie resolution phase.
 *
 * Inputs:
 *   role         — must be 'clean' (infected players cannot prove innocence)
 *   secret       — player's private salt (bigint)
 *   commitment   — Poseidon(role, secret) stored on-chain
 *   roomId       — binds proof to this room
 *   roundNumber  — prevents cross-round replay
 */
export async function proveInnocence(params: {
  role: 'clean'
  secret: bigint
  commitment: string
  roomId: string | bigint
  roundNumber: number | bigint
}): Promise<ZKProof> {
  const { role, secret, commitment, roomId, roundNumber } = params

  if (role !== 'clean') {
    throw new Error('Only clean players can generate an innocence proof')
  }

  const roleNum = ROLE_CLEAN
  const roomField = typeof roomId === 'bigint' ? roomId : BigInt(roomId)
  const roundField = BigInt(roundNumber)

  // Nullifier = poseidon2_permutation([secret, room_id, round_number, 0])[0]
  const nullifier = await hash3(secret, roomField, roundField)

  const circuit = await loadCircuit('innocence_proof')
  const noir = new Noir(circuit)

  const { witness } = await noir.execute({
    commitment: toField(BigInt(commitment)),
    nullifier: toField(nullifier),
    role: toField(roleNum),
    secret: toField(secret),
    room_id: toField(roomField),
    round_number: toField(roundField),
  })

  const proof = await backendProve('innocence_proof', witness)

  return {
    proof: Array.from(proof),
    publicInputs: [],
    circuitType: 'innocence',
    nullifier: toField(nullifier),
  } as unknown as ZKProof
}

// ─── Infection proof ────────────────────────────────────────────────────────

/**
 * Generates a ZK proof that the caller is the current patient-zero and
 * performed a valid infection on targetAddress this round.
 *
 * Only the current patient-zero can pass the circuit assertion:
 *   infector_commitment == current_patient_zero_commitment
 */
export async function proveInfection(params: {
  infectorRole: 'patient_zero'
  secret: bigint
  infectorCommitment: string
  currentPatientZeroCommitment: string
  targetAddress: string
  roundNumber: number | bigint
}): Promise<ZKProof> {
  const {
    secret,
    infectorCommitment,
    currentPatientZeroCommitment,
    targetAddress,
    roundNumber,
  } = params

  const roleNum = ROLE_PATIENT_ZERO
  const roundField = BigInt(roundNumber)

  // targetAddress as a Field: take lower 31 bytes to stay inside BN254 scalar field
  const targetField = BigInt(targetAddress) & ((1n << 248n) - 1n)

  // Nullifier = poseidon2_permutation([secret, target_address, round_number, 0])[0]
  const nullifier = await hash3(secret, targetField, roundField)

  const circuit = await loadCircuit('infection_proof')
  const noir = new Noir(circuit)

  const { witness } = await noir.execute({
    infector_commitment: toField(BigInt(infectorCommitment)),
    current_patient_zero_commitment: toField(BigInt(currentPatientZeroCommitment)),
    target_address: toField(targetField),
    nullifier: toField(nullifier),
    infector_role: toField(roleNum),
    infector_secret: toField(secret),
    round_number: toField(roundField),
  })

  const proof = await backendProve('infection_proof', witness)

  return {
    proof: Array.from(proof),
    publicInputs: [],
    circuitType: 'infection',
    nullifier: toField(nullifier),
  } as unknown as ZKProof
}

// ─── Role commitment proof ───────────────────────────────────────────────────

/**
 * Generates a ZK proof that the player knows a (role, secret) pair that
 * hashes to their on-chain commitment, without revealing the role.
 */
export async function proveRoleCommitment(params: {
  role: 'patient_zero' | 'clean'
  secret: bigint
  commitment: string
}): Promise<ZKProof> {
  const { role, secret, commitment } = params
  const roleNum = role === 'patient_zero' ? ROLE_PATIENT_ZERO : ROLE_CLEAN

  const circuit = await loadCircuit('role_commitment')
  const noir = new Noir(circuit)

  const { witness } = await noir.execute({
    commitment: toField(BigInt(commitment)),
    role: toField(roleNum),
    secret: toField(secret),
  })

  const proof = await backendProve('role_commitment', witness)

  return {
    proof: Array.from(proof),
    publicInputs: [],
    circuitType: 'role',
  } as unknown as ZKProof
}

// ─── Client-side verification ───────────────────────────────────────────────

/**
 * Verifies a proof on the client before submitting on-chain.
 * Saves gas and gives the user immediate feedback.
 */
export async function verifyProofLocally(
  zkProof: ZKProof & { proof: number[]; publicInputs: string[] },
  circuitType: 'role' | 'infection' | 'innocence'
): Promise<boolean> {
  const circuitNames: Record<typeof circuitType, string> = {
    role: 'role_commitment',
    infection: 'infection_proof',
    innocence: 'innocence_proof',
  }
  const circuitName = circuitNames[circuitType]

  const circuit = await loadCircuit(circuitName)
  const backend = new UltraHonkBackend(circuit)

  return backend.verifyProof({
    proof: new Uint8Array(zkProof.proof),
    publicInputs: zkProof.publicInputs,
  })
}

// ─── Convenience: compute nullifier without full proof ──────────────────────

/**
 * Computes the innocence nullifier deterministically.
 * Useful for checking whether a player has already submitted this round
 * before generating a full proof.
 */
export async function computeInnocenceNullifier(
  secret: bigint,
  roomId: bigint,
  roundNumber: bigint
): Promise<bigint> {
  return hash3(secret, roomId, roundNumber)
}

/**
 * Computes the infection nullifier deterministically.
 */
export async function computeInfectionNullifier(
  secret: bigint,
  targetAddress: string,
  roundNumber: bigint
): Promise<bigint> {
  const targetField = BigInt(targetAddress) & ((1n << 248n) - 1n)
  return hash3(secret, targetField, roundNumber)
}
