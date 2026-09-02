/**
 * proofQueue.ts — admission control for `bb prove`.
 *
 * POST /api/prove has to stay open and unauthenticated: a third-party agent
 * that wants to play needs role-commitment and innocence proofs, and it has no
 * credential to present. But each call forks a native `bb` process with a 120s
 * timeout, and the box is a 2-core Lighthouse VPS that also serves the lobby,
 * the socket layer and room discovery. Unbounded, a few dozen concurrent POSTs
 * pin both cores for minutes and take api.zplague.xyz down — game included.
 *
 * So the limit is on CONCURRENCY, not identity: proofs run `MAX_CONCURRENT` at
 * a time and the rest wait in a bounded queue.
 *
 * Deliberately NOT a per-IP quota. All 8 pool bots reach the backend over the
 * docker network at http://backend:4000, so Express sees one source address for
 * the entire pool; an IP bucket would throttle the bots as a unit and stall
 * real games. Concurrency is the property that actually matters here — it caps
 * CPU regardless of who is asking.
 */
import { logger } from './logger'

/** Simultaneous `bb` processes. Matches the box's core count. */
const MAX_CONCURRENT = Number(process.env.PROVE_MAX_CONCURRENT ?? 2)
/** Depth of the wait queue before new work is refused outright. */
const MAX_QUEUED = Number(process.env.PROVE_MAX_QUEUED ?? 12)
/** How long a request will wait for a slot before giving up. */
const QUEUE_TIMEOUT_MS = Number(process.env.PROVE_QUEUE_TIMEOUT_MS ?? 45_000)

/** Raised when the queue is full or a request waited too long for a slot. */
export class ProofBusyError extends Error {
  /** Seconds the caller should wait before retrying. */
  readonly retryAfterSecs: number
  constructor(message: string, retryAfterSecs: number) {
    super(message)
    this.name = 'ProofBusyError'
    this.retryAfterSecs = retryAfterSecs
  }
}

let active = 0
const waiting: Array<() => void> = []

function release(): void {
  active--
  const next = waiting.shift()
  if (next) next()
}

/** Wait for a proving slot, or throw ProofBusyError. */
async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return
  }
  if (waiting.length >= MAX_QUEUED) {
    throw new ProofBusyError('Proof service saturated', 30)
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      // Drop our slot-grant callback so a later release() doesn't hand a slot
      // to a request that has already been answered.
      const i = waiting.indexOf(grant)
      if (i !== -1) waiting.splice(i, 1)
      reject(new ProofBusyError('Timed out waiting for a proving slot', 30))
    }, QUEUE_TIMEOUT_MS)

    function grant(): void {
      if (settled) {
        // Unreachable in practice: the timeout path splices `grant` out of
        // `waiting`, and neither callback can interleave with the other under a
        // single-threaded loop. Kept correct rather than merely defensive —
        // take the slot release() just handed us, then pass it straight on, so
        // the counter nets to zero instead of going negative.
        active++
        release()
        return
      }
      settled = true
      clearTimeout(timer)
      active++
      resolve()
    }

    waiting.push(grant)
  })
}

/**
 * Run `fn` holding one proving slot. Throws ProofBusyError without ever
 * invoking `fn` when the service is saturated.
 */
export async function withProofSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  if (waiting.length > 0) {
    logger.debug('proofQueue: running with backlog', { active, queued: waiting.length })
  }
  try {
    return await fn()
  } finally {
    release()
  }
}

/** For /health and diagnostics. */
export function proofQueueStats(): { active: number; queued: number; maxConcurrent: number } {
  return { active, queued: waiting.length, maxConcurrent: MAX_CONCURRENT }
}
