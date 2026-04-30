// TODO: Issue #35 - Implement ZK proof generation utilities using snarkjs
// Circuits live in /zk/circuits/

import type { ZKProof, RoleCommitment } from '@/types/game'

/**
 * Generates a role commitment hash using Poseidon hash
 * Called at game start — commits the player's role without revealing it
 * TODO: Issue #35
 */
export async function generateRoleCommitment(
  role: 'patient_zero' | 'clean',
  secret: string
): Promise<RoleCommitment> {
  throw new Error('Not implemented — see GitHub issue #35')
}

/**
 * Generates a ZK proof that a player is innocent (clean)
 * without revealing their actual role
 * TODO: Issue #36
 */
export async function proveInnocence(
  role: string,
  secret: string,
  commitment: string
): Promise<ZKProof> {
  throw new Error('Not implemented — see GitHub issue #36')
}

/**
 * Generates a ZK proof that a player performed an infection action
 * on a target without revealing who Patient Zero is
 * TODO: Issue #37
 */
export async function proveInfection(
  infectorRole: string,
  targetAddress: string,
  secret: string,
  roundNumber: number
): Promise<ZKProof> {
  throw new Error('Not implemented — see GitHub issue #37')
}

/**
 * Verifies a ZK proof on the client before submitting on-chain
 * TODO: Issue #38
 */
export async function verifyProofLocally(
  proof: ZKProof,
  circuitType: 'role' | 'infection' | 'innocence'
): Promise<boolean> {
  throw new Error('Not implemented — see GitHub issue #38')
}
