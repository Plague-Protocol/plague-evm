/**
 * Nonce queue — serializes writes from a single signer.
 *
 * Every phase transition of every live room is a txn from ONE backend signer,
 * and the phase lock in the socket layer is per-room, not global. Two rooms
 * advancing in the same instant therefore derived the same nonce
 * independently, and one txn was silently dropped by the node — stranding that
 * room mid-phase until a human noticed. The failure gets proportionally more
 * likely as concurrent rooms rise, so it gates raising `maxActiveRooms`.
 *
 * Sends are handed nonces from a locally tracked counter, one at a time.
 * Confirmation waiting happens OUTSIDE the lock, so throughput isn't capped at
 * one txn per block confirmation.
 *
 * The counter is dropped (re-read from chain on the next send) whenever it
 * can't be trusted: after a failed send, and whenever nothing is outstanding.
 */

export interface NonceQueueOptions {
  /** Reads the signer's pending nonce from chain. */
  fetchNonce: () => Promise<number>
  /** Notified whenever the local counter is dropped, with the reason. */
  onResync?: (reason: string) => void
}

export interface NonceQueue {
  /**
   * Sends one txn with a serialized nonce, then awaits confirmation off-lock.
   *
   * `send` must resolve with the txn hash once the node has accepted it.
   * `confirm` should reject rather than hang forever — an unbounded wait pins
   * the outstanding count above zero and stops the counter ever resyncing.
   */
  run<T>(
    send: (nonce: number) => Promise<`0x${string}`>,
    confirm: (hash: `0x${string}`) => Promise<T>,
  ): Promise<T>
  /** Introspection for tests and health reporting. */
  stats(): { nextNonce: number | null; unconfirmed: number }
}

export function createNonceQueue({ fetchNonce, onResync }: NonceQueueOptions): NonceQueue {
  /** Tail of the serialized chain. Never rejects — see `enqueue`. */
  let chain: Promise<void> = Promise.resolve()
  /** Next nonce to hand out; null = re-read from chain on the next send. */
  let nextNonce: number | null = null
  /** Txns sent but not yet settled. At zero the counter resyncs. */
  let unconfirmed = 0

  const resync = (reason: string) => {
    if (nextNonce === null) return
    nextNonce = null
    onResync?.(reason)
  }

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn)
    // The chain itself must never reject, or one failed send would poison
    // every write queued behind it.
    chain = run.then(() => undefined, () => undefined)
    return run
  }

  return {
    async run(send, confirm) {
      const hash = await enqueue(async () => {
        nextNonce ??= await fetchNonce()
        const nonce = nextNonce
        try {
          const sent = await send(nonce)
          // Advance from the local `nonce`, not `nextNonce`: a confirmation
          // landing concurrently may have nulled it mid-send. This nonce was
          // still the right one to use, so the successor is still nonce + 1.
          nextNonce = nonce + 1
          unconfirmed++
          return sent
        } catch (err) {
          // Nonce too low, replacement underpriced, upstream rejected — the
          // counter can no longer be trusted.
          nextNonce = null
          onResync?.(`send failed at nonce ${nonce}`)
          throw err
        }
      })

      try {
        return await confirm(hash)
      } finally {
        unconfirmed--
        if (unconfirmed <= 0) {
          unconfirmed = 0
          resync('nothing outstanding')
        }
      }
    },

    stats() {
      return { nextNonce, unconfirmed }
    },
  }
}
