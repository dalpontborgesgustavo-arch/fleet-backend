ALTER TABLE "User"
ADD COLUMN "canExecuteMaintenance" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET "canExecuteMaintenance" = true
WHERE "active" = true
  AND LOWER("email") IN (
    'silvio.duarte@jrmc.com.br',
    'marcelo.cascaes@jrmc.com.br'
  );
