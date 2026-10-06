ALTER TABLE "AethosContract"
  ADD COLUMN "contractedAt" TIMESTAMP(3),
  ADD COLUMN "lastContractedAt" TIMESTAMP(3),
  ADD COLUMN "contractedByUser" TEXT;

CREATE INDEX "AethosContract_contractedAt_idx"
  ON "AethosContract"("contractedAt");

-- A carga de 2026 chegou antes desta coluna existir. Recupera imediatamente
-- os dados oficiais preservados no payload bruto sem aguardar novo envio.
UPDATE "AethosContract"
SET
  "contractedAt" = CASE
    WHEN COALESCE("raw"->>'dataContratado', '') ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
      THEN ("raw"->>'dataContratado')::timestamp(3)
    ELSE NULL
  END,
  "lastContractedAt" = CASE
    WHEN COALESCE("raw"->>'dataUltimaContratacao', '') ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
      THEN ("raw"->>'dataUltimaContratacao')::timestamp(3)
    ELSE NULL
  END,
  "contractedByUser" = NULLIF(BTRIM("raw"->>'usuarioContratacao'), '')
WHERE "raw" ?| ARRAY[
  'dataContratado',
  'dataUltimaContratacao',
  'usuarioContratacao'
];
