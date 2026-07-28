import { createNonceQueue } from './nonceQueue'

/** Deferred promise — lets a test hold a send/confirm open on demand. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`
const settled = <T,>(p: Promise<T>) => p.then(() => 'ok' as const, () => 'err' as const)

describe('createNonceQueue', () => {
  it('hands out consecutive nonces across a burst, reading chain once', async () => {
    const fetchNonce = jest.fn(async () => 7)
    const q = createNonceQueue({ fetchNonce })
    const seen: number[] = []

    // Confirmations are held open so all three overlap — this is the exact
    // shape of several rooms advancing phase in the same instant.
    const holds = [deferred<void>(), deferred<void>(), deferred<void>()]
    const runs = holds.map((hold, i) =>
      q.run(
        async nonce => { seen.push(nonce); return hash(i) },
        async () => { await hold.promise; return i },
      )
    )

    // Let the sends drain before releasing any confirmation.
    await new Promise(r => setImmediate(r))
    expect(seen).toEqual([7, 8, 9])
    expect(fetchNonce).toHaveBeenCalledTimes(1)

    holds.forEach(h => h.resolve())
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2])
  })

  it('never runs two sends concurrently', async () => {
    const q = createNonceQueue({ fetchNonce: async () => 0 })
    let inFlight = 0
    let maxInFlight = 0

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        q.run(
          async () => {
            inFlight++
            maxInFlight = Math.max(maxInFlight, inFlight)
            await new Promise(r => setTimeout(r, 1))
            inFlight--
            return hash(i)
          },
          async () => i,
        )
      )
    )

    expect(maxInFlight).toBe(1)
  })

  it('re-reads the nonce from chain once nothing is outstanding', async () => {
    let chainNonce = 3
    const fetchNonce = jest.fn(async () => chainNonce)
    const q = createNonceQueue({ fetchNonce })
    const seen: number[] = []
    const send = async (nonce: number) => { seen.push(nonce); chainNonce = nonce + 1; return hash(nonce) }

    await q.run(send, async () => undefined)
    await q.run(send, async () => undefined)

    expect(seen).toEqual([3, 4])
    // Each write settled fully before the next began, so the counter is
    // dropped each time rather than trusted across an idle gap.
    expect(fetchNonce).toHaveBeenCalledTimes(2)
    expect(q.stats()).toEqual({ nextNonce: null, unconfirmed: 0 })
  })

  it('resyncs after a failed send instead of reusing the burnt nonce', async () => {
    const fetchNonce = jest.fn(async () => 11)
    const onResync = jest.fn()
    const q = createNonceQueue({ fetchNonce, onResync })

    await expect(
      q.run(async () => { throw new Error('replacement transaction underpriced') }, async () => undefined)
    ).rejects.toThrow('replacement transaction underpriced')

    expect(q.stats().nextNonce).toBeNull()
    expect(onResync).toHaveBeenCalledWith('send failed at nonce 11')

    const seen: number[] = []
    await q.run(async n => { seen.push(n); return hash(n) }, async () => undefined)
    expect(seen).toEqual([11])
    expect(fetchNonce).toHaveBeenCalledTimes(2)
  })

  it('does not let a failed send poison writes queued behind it', async () => {
    const q = createNonceQueue({ fetchNonce: async () => 20 })
    const seen: number[] = []

    const bad = q.run(async () => { throw new Error('rejected') }, async () => 'bad')
    const good = q.run(async n => { seen.push(n); return hash(n) }, async () => 'good')

    await expect(settled(bad)).resolves.toBe('err')
    await expect(good).resolves.toBe('good')
    expect(seen).toEqual([20])
  })

  it('releases the outstanding count when a confirmation times out', async () => {
    const fetchNonce = jest.fn(async () => 5)
    const q = createNonceQueue({ fetchNonce })

    // A dropped txn: sent fine, receipt never arrives and the wait rejects.
    // If this leaked, unconfirmed would stay above zero forever and the
    // counter could never resync — every later write would use a stale nonce.
    await expect(
      settled(q.run(async n => hash(n), async () => { throw new Error('timed out') }))
    ).resolves.toBe('err')

    expect(q.stats()).toEqual({ nextNonce: null, unconfirmed: 0 })

    const seen: number[] = []
    await q.run(async n => { seen.push(n); return hash(n) }, async () => undefined)
    expect(seen).toEqual([5])
    expect(fetchNonce).toHaveBeenCalledTimes(2)
  })

  it('keeps the successor nonce correct when a confirmation lands mid-send', async () => {
    const fetchNonce = jest.fn(async () => 30)
    const q = createNonceQueue({ fetchNonce })
    const seen: number[] = []

    const firstConfirm = deferred<void>()
    const first = q.run(async n => { seen.push(n); return hash(n) }, async () => { await firstConfirm.promise })

    // Second send is held open; the first confirmation resolves while it is
    // in flight, zeroing the outstanding count and dropping the counter.
    const secondSend = deferred<void>()
    const second = q.run(
      async n => { seen.push(n); await secondSend.promise; return hash(n) },
      async () => undefined,
    )

    await new Promise(r => setImmediate(r))
    firstConfirm.resolve()
    await first
    secondSend.resolve()
    await second

    // The second send must still have used 31 — not refetched 30 and collided.
    expect(seen).toEqual([30, 31])
  })
})
