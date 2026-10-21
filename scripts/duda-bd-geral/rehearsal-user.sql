-- Only for the isolated empty CI rehearsal database. Production already has
-- the full User table; this file is never part of the migration chain.
CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
