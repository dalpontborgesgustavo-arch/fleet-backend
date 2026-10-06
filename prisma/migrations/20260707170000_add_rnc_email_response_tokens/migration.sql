CREATE TABLE "RncEmailToken" (
    "id" TEXT NOT NULL,
    "rncId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "targetUserId" TEXT NOT NULL,
    "targetEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ASSIGNMENT_RESPONSE',
    "sentAt" TIMESTAMP(3),
    "lastEmailError" TEXT,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "responseIp" TEXT,
    "responseUserAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RncEmailToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RncEmailToken_tokenHash_key" ON "RncEmailToken"("tokenHash");
CREATE INDEX "RncEmailToken_rncId_idx" ON "RncEmailToken"("rncId");
CREATE INDEX "RncEmailToken_assignmentId_idx" ON "RncEmailToken"("assignmentId");
CREATE INDEX "RncEmailToken_targetUserId_idx" ON "RncEmailToken"("targetUserId");
CREATE INDEX "RncEmailToken_targetEmail_idx" ON "RncEmailToken"("targetEmail");
CREATE INDEX "RncEmailToken_expiresAt_idx" ON "RncEmailToken"("expiresAt");

ALTER TABLE "RncEmailToken"
ADD CONSTRAINT "RncEmailToken_rncId_fkey"
FOREIGN KEY ("rncId") REFERENCES "Rnc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RncEmailToken"
ADD CONSTRAINT "RncEmailToken_assignmentId_fkey"
FOREIGN KEY ("assignmentId") REFERENCES "RncAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RncEmailToken"
ADD CONSTRAINT "RncEmailToken_targetUserId_fkey"
FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
