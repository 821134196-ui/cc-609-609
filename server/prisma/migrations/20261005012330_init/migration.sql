-- CreateTable
CREATE TABLE "Voyage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voyageNo" TEXT NOT NULL,
    "vessel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CrewList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voyageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "submittedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrewList_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrewMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "docTail" TEXT NOT NULL,
    "photoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NORMAL',
    "statusNote" TEXT,
    CONSTRAINT "CrewMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CrewList" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PassEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventNo" TEXT NOT NULL,
    "voyageId" TEXT NOT NULL,
    "memberId" TEXT,
    "docNo" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'GATE',
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PassEvent_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PassEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "CrewMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DepartureConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voyageId" TEXT NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "listVersion" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepartureConfirmation_voyageId_fkey" FOREIGN KEY ("voyageId") REFERENCES "Voyage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Voyage_voyageNo_key" ON "Voyage"("voyageNo");

-- CreateIndex
CREATE UNIQUE INDEX "CrewList_voyageId_version_key" ON "CrewList"("voyageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PassEvent_eventNo_key" ON "PassEvent"("eventNo");

-- CreateIndex
CREATE INDEX "PassEvent_voyageId_docNo_idx" ON "PassEvent"("voyageId", "docNo");

-- CreateIndex
CREATE UNIQUE INDEX "DepartureConfirmation_voyageId_key" ON "DepartureConfirmation"("voyageId");
