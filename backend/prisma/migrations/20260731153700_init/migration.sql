-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'LABELED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "tabUrl" TEXT NOT NULL,
    "tabTitle" TEXT NOT NULL,
    "screenshotKey" TEXT,
    "screenshotUrl" TEXT,
    "domSignals" JSONB,
    "aiActivity" TEXT,
    "aiApp" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "labeledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_installId_key" ON "User"("installId");

-- CreateIndex
CREATE INDEX "Event_userId_capturedAt_idx" ON "Event"("userId", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "Event_userId_status_idx" ON "Event"("userId", "status");

-- CreateIndex
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
