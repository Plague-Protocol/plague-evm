-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('waiting', 'starting', 'active', 'ended');

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "hostAddress" TEXT NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'waiting',
    "maxPlayers" INTEGER NOT NULL,
    "stakeAmount" TEXT NOT NULL,
    "proofFee" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomPlayer" (
    "id" TEXT NOT NULL,
    "roomDbId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_roomId_key" ON "Room"("roomId");

-- CreateIndex
CREATE INDEX "Room_status_expiresAt_idx" ON "Room"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "RoomPlayer_address_idx" ON "RoomPlayer"("address");

-- CreateIndex
CREATE UNIQUE INDEX "RoomPlayer_roomDbId_address_key" ON "RoomPlayer"("roomDbId", "address");

-- AddForeignKey
ALTER TABLE "RoomPlayer" ADD CONSTRAINT "RoomPlayer_roomDbId_fkey" FOREIGN KEY ("roomDbId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
