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
import { poseidon2 } from 'poseidon-lite'
import type { ZKProof, RoleCommitment } from '@/types/game'

// ─── Constants ─────────────────────────────────────────────────────────────

const ROLE_CLEAN = 0n
const ROLE_PATIENT_ZERO = 1n

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
async function loadCircuit(name: string): Promise<{ bytecode: string; abi: object }> {
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
 * Generates Poseidon(role, secret) on the client.
 * This value is submitted on-chain at game start and later used to anchor
 * ZK proofs without revealing the role.
 *
 * Uses poseidon2 (BN254) — matches the Noir circuit's poseidon::bn254::hash_2.
 */
export async function generateRoleCommitment(
  role: 'patient_zero' | 'clean',
  secret: bigint
): Promise<RoleCommitment> {
  const roleNum = role === 'patient_zero' ? ROLE_PATIENT_ZERO : ROLE_CLEAN
  const commitment = poseidon2([roleNum, secret])
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

  // Nullifier = Poseidon(secret, room_id, round_number)
  const nullifier = poseidon2([secret, roomField, roundField])

  const circuit = await loadCircuit('innocence_proof')
  const backend = new UltraHonkBackend(circuit.bytecode)
  const noir = new Noir(circuit as never)

  const { witness } = await noir.execute({
    commitment: toField(BigInt(commitment)),
    nullifier: toField(nullifier),
    role: toField(roleNum),
    secret: toField(secret),
    room_id: toField(roomField),
    round_number: toField(roundField),
  })

  const { proof, publicInputs } = await backend.generateProof(witness)

  return {
    proof: Array.from(proof),
    publicInputs,
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

  // Nullifier = Poseidon(secret, target_address, round_number)
  const nullifier = poseidon2([secret, targetField, roundField])

  const circuit = await loadCircuit('infection_proof')
  const backend = new UltraHonkBackend(circuit.bytecode)
  const noir = new Noir(circuit as never)

  const { witness } = await noir.execute({
    infector_commitment: toField(BigInt(infectorCommitment)),
    current_patient_zero_commitment: toField(BigInt(currentPatientZeroCommitment)),
    target_address: toField(targetField),
    nullifier: toField(nullifier),
    infector_role: toField(roleNum),
    infector_secret: toField(secret),
    round_number: toField(roundField),
  })

  const { proof, publicInputs } = await backend.generateProof(witness)

  return {
    proof: Array.from(proof),
    publicInputs,
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
  const backend = new UltraHonkBackend(circuit.bytecode)
  const noir = new Noir(circuit as never)

  const { witness } = await noir.execute({
    commitment: toField(BigInt(commitment)),
    role: toField(roleNum),
    secret: toField(secret),
  })

  const { proof, publicInputs } = await backend.generateProof(witness)

  return {
    proof: Array.from(proof),
    publicInputs,
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
  const backend = new UltraHonkBackend(circuit.bytecode)

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
export function computeInnocenceNullifier(
  secret: bigint,
  roomId: bigint,
  roundNumber: bigint
): bigint {
  return poseidon2([secret, roomId, roundNumber])
}

/**
 * Computes the infection nullifier deterministically.
 */
export function computeInfectionNullifier(
  secret: bigint,
  targetAddress: string,
  roundNumber: bigint
): bigint {
  const targetField = BigInt(targetAddress) & ((1n << 248n) - 1n)
  return poseidon2([secret, targetField, roundNumber])
}
