/**
 * One-off: mark rooms `ended` when their game already finished.
 *
 * `setRoomStatus` used to be called from a single place — the expiry sweep — so
 * only rooms that expired *unfilled* ever left `waiting`. A room played all the
 * way to a result kept the default status forever, which held its name against
 * the next host and kept its own host blocked from opening another room.
 *
 * A GameSummary row is the proof a game finished, so that is the only thing
 * this promotes.
 *
 * Deliberately does NOT touch waiting rooms that are merely past `expiresAt`.
 * Those still hold stakes on-chain and the expiry sweep finds them by querying
 * `status = 'waiting'`. Marking them ended here would hide them from the sweep
 * and strand the host's stake in the contract.
 *
 * Run from the backend container, which already has DATABASE_URL:
 *   docker compose exec backend node dist/scripts/backfill-ended-rooms.js --dry
 * Drop --dry to write. Safe to run twice — the second run is a no-op.
 */

import { prisma } from '../db/prisma'

const dryRun = process.argv.includes('--dry')

async function main(): Promise<void> {
  const summarised = await prisma.gameSummary.findMany({ select: { roomId: true } })
  const roomIds = summarised.map(s => s.roomId)
  console.log(`${roomIds.length} finished games on record`)

  const stale = await prisma.room.findMany({
    where: { roomId: { in: roomIds }, status: { not: 'ended' } },
    select: { roomId: true, name: true, status: true },
  })

  if (stale.length === 0) {
    console.log('nothing to fix — every finished game is already marked ended')
    return
  }

  console.log(`${stale.length} finished rooms still marked as live:`)
  for (const r of stale) {
    console.log(`  room ${r.roomId}  status=${r.status}  name=${r.name ?? '(unnamed)'}`)
  }

  if (dryRun) {
    console.log('\n--dry given, nothing written')
    return
  }

  const { count } = await prisma.room.updateMany({
    where: { roomId: { in: stale.map(r => r.roomId) } },
    data: { status: 'ended' },
  })
  console.log(`\nmarked ${count} rooms ended — their names are free again`)

  // The repository also caches rooms in Redis, but a cached copy is refreshed on
  // the next read of that room and an ended room is not on any hot path. Left
  // alone rather than reaching into another module's cache from a one-off.
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
