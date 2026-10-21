CREATE TABLE "DudaBdGeralViewPreference" (
    "userId" TEXT NOT NULL,
    "hiddenColumns" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DudaBdGeralViewPreference_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "DudaBdGeralViewPreference" ADD CONSTRAINT "DudaBdGeralViewPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
