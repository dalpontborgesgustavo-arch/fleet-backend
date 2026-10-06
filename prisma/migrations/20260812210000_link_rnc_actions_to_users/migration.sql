ALTER TABLE "RncCorrectiveAction"
ADD COLUMN IF NOT EXISTS "responsibleUserId" TEXT;

-- Acoes antigas so sao vinculadas automaticamente quando existe exatamente
-- um usuario ativo com o mesmo nome. O texto historico continua preservado.
WITH "UniqueActiveUserByName" AS (
  SELECT
    LOWER(TRIM("name")) AS "normalizedName",
    MIN("id") AS "userId"
  FROM "User"
  WHERE "active" = TRUE
    AND TRIM("name") <> ''
  GROUP BY LOWER(TRIM("name"))
  HAVING COUNT(*) = 1
)
UPDATE "RncCorrectiveAction" AS action
SET "responsibleUserId" = match."userId"
FROM "UniqueActiveUserByName" AS match
WHERE action."responsibleUserId" IS NULL
  AND LOWER(TRIM(action."responsible")) = match."normalizedName";

CREATE INDEX IF NOT EXISTS "RncCorrectiveAction_responsibleUserId_idx"
ON "RncCorrectiveAction"("responsibleUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'RncCorrectiveAction_responsibleUserId_fkey'
  ) THEN
    ALTER TABLE "RncCorrectiveAction"
    ADD CONSTRAINT "RncCorrectiveAction_responsibleUserId_fkey"
    FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
