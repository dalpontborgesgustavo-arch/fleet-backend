ALTER TABLE "AethosPlanoContaCost"
ADD COLUMN "temNotaFiscal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "idNotaFiscal" TEXT,
ADD COLUMN "numeroNotaFiscal" TEXT,
ADD COLUMN "dataEmissaoNotaFiscal" TIMESTAMP(3),
ADD COLUMN "observacaoLancamento" TEXT,
ADD COLUMN "observacaoNotaFiscal" TEXT;

UPDATE "AethosPlanoContaCost"
SET
  "temNotaFiscal" = CASE
    WHEN LOWER(COALESCE(raw->>'temNotaFiscal', 'false')) IN ('true', '1', 'sim', 's', 'yes', 'y') THEN true
    ELSE false
  END,
  "idNotaFiscal" = NULLIF(BTRIM(raw->>'idNotaFiscal'), ''),
  "numeroNotaFiscal" = NULLIF(BTRIM(raw->>'numeroNotaFiscal'), ''),
  "dataEmissaoNotaFiscal" = CASE
    WHEN raw->>'dataEmissaoNotaFiscal' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      THEN LEFT(raw->>'dataEmissaoNotaFiscal', 10)::date::timestamp
    ELSE NULL
  END,
  "observacaoLancamento" = NULLIF(BTRIM(raw->>'observacaoLancamento'), ''),
  "observacaoNotaFiscal" = NULLIF(BTRIM(raw->>'observacaoNotaFiscal'), '')
WHERE raw IS NOT NULL;

CREATE INDEX "AethosPlanoContaCost_dataLancamento_idx"
ON "AethosPlanoContaCost"("dataLancamento");

CREATE INDEX "AethosPlanoContaCost_dataEmissaoNotaFiscal_idx"
ON "AethosPlanoContaCost"("dataEmissaoNotaFiscal");
