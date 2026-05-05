import { Noir } from '@noir-lang/noir_js'
import { UltraHonkBackend } from '@noir-lang/backend_barretenberg'
import { Barretenberg, Fr } from '@aztec/bb.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  try {
    const circuit = JSON.parse(readFileSync(join(__dirname, 'frontend/public/circuits/role_commitment.json'), 'utf8'))
    console.log('Circuit loaded, noir_version:', circuit.noir_version)
    
    // Derive secret from 'testing1'
    const encoder = new TextEncoder()
    const data = encoder.encode('testing1')
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
    const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
    const secret = BigInt('0x' + hex) % BN254_R
    console.log('Secret derived')
    
    // Generate commitment using Barretenberg
    const bb = await Barretenberg.new({ threads: 1 })
    const res = await bb.poseidon2Permutation([new Fr(0n), new Fr(secret), Fr.ZERO, Fr.ZERO])
    const commitment = BigInt(res[0].toString())
    const toField = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0')
    const commitmentHex = toField(commitment)
    console.log('Commitment:', commitmentHex.slice(0, 20) + '...')
    
    // Try witness generation
    const noir = new Noir(circuit)
    console.log('Starting witness generation...')
    const { witness } = await noir.execute({
      commitment: toField(commitment),
      role: toField(0n),
      secret: toField(secret),
    })
    console.log('Witness generated OK, length:', witness.length)
    
    // Try proof generation
    console.log('Starting proof generation...')
    const backend = new UltraHonkBackend(circuit)
    const { proof, publicInputs } = await backend.generateProof(witness)
    console.log('Proof generated OK, length:', proof.length, 'publicInputs:', publicInputs.length)
    
    await bb.destroy()
    await backend.destroy()
    console.log('SUCCESS')
  } catch (e) {
    console.error('ERROR:', e.message)
    console.error(e.stack?.slice(0, 1000))
  }
}

main()
