-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "name" TEXT;

-- CreateTable
CREATE TABLE "PlayerNickname" (
    "address" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerNickname_pkey" PRIMARY KEY ("address")
);
