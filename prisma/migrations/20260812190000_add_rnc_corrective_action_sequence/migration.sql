ALTER TABLE "RncCorrectiveAction"
  ADD COLUMN "sequence" INTEGER;

-- Preserva a ordem que ja era exibida para as acoes existentes. O CTID e
-- usado apenas nesta migracao para desempatar registros criados no mesmo
-- milissegundo; daqui em diante a sequencia passa a ser explicita e imutavel.
WITH ranked_actions AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "rncId"
      ORDER BY "createdAt" ASC, ctid ASC
    )::INTEGER AS "sequence"
  FROM "RncCorrectiveAction"
)
UPDATE "RncCorrectiveAction" action
SET "sequence" = ranked."sequence"
FROM ranked_actions ranked
WHERE ranked."id" = action."id";

-- RNC 77: as acoes de Meio Ambiente e Seguranca foram originalmente
-- registradas como 3 e 4, mas um empate em createdAt fez com que fossem
-- exibidas no fim depois da conclusao. Restaura a ordem original informada.
WITH desired_order AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      ORDER BY
        CASE
          WHEN "id" = '6c475c5b-56ee-4870-803f-8ab6f85904af' THEN 3
          WHEN "id" = '1975a644-8ce8-43c3-9ba1-8f46355a1e50' THEN 4
          WHEN "sequence" <= 2 THEN "sequence"
          ELSE "sequence" + 2
        END,
        "sequence"
    )::INTEGER AS "sequence"
  FROM "RncCorrectiveAction"
  WHERE "rncId" = '10b392d0-4976-4422-9685-026814ae0fc6'
)
UPDATE "RncCorrectiveAction" action
SET "sequence" = desired."sequence"
FROM desired_order desired
WHERE desired."id" = action."id";

ALTER TABLE "RncCorrectiveAction"
  ALTER COLUMN "sequence" SET NOT NULL;

CREATE UNIQUE INDEX "RncCorrectiveAction_rncId_sequence_key"
  ON "RncCorrectiveAction"("rncId", "sequence");
