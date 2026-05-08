-- CreateTable
CREATE TABLE "GameSummary" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "totalRounds" INTEGER NOT NULL,
    "totalPot" TEXT NOT NULL,
    "potPerWinner" TEXT NOT NULL,
    "winnerCount" INTEGER NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSummaryPlayer" (
    "id" TEXT NOT NULL,
    "gameSummaryId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "displayNameSnapshot" TEXT,
    "result" TEXT NOT NULL,
    "proofsSubmittedTotal" INTEGER NOT NULL DEFAULT 0,
    "statusAtEnd" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),

    CONSTRAINT "GameSummaryPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameSummary_roomId_key" ON "GameSummary"("roomId");

-- CreateIndex
CREATE INDEX "GameSummary_endedAt_idx" ON "GameSummary"("endedAt");

-- CreateIndex
CREATE INDEX "GameSummary_outcome_idx" ON "GameSummary"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "GameSummaryPlayer_gameSummaryId_address_key" ON "GameSummaryPlayer"("gameSummaryId", "address");

-- CreateIndex
CREATE INDEX "GameSummaryPlayer_address_idx" ON "GameSummaryPlayer"("address");

-- CreateIndex
CREATE INDEX "GameSummaryPlayer_result_idx" ON "GameSummaryPlayer"("result");

-- AddForeignKey
ALTER TABLE "GameSummaryPlayer" ADD CONSTRAINT "GameSummaryPlayer_gameSummaryId_fkey" FOREIGN KEY ("gameSummaryId") REFERENCES "GameSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;