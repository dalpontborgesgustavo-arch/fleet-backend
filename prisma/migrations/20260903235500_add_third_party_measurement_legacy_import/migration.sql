ALTER TABLE "ThirdPartyMeasurement"
  ADD COLUMN IF NOT EXISTS "actualPaymentDate" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ThirdPartyMeasurementLegacyImportBatch" (
  "id" TEXT NOT NULL,
  "sourceFileName" TEXT NOT NULL,
  "sourceFileSha256" TEXT NOT NULL,
  "candidateFileSha256" TEXT NOT NULL,
  "exceptionsFileSha256" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "candidateCount" INTEGER NOT NULL,
  "exceptionMatrixCount" INTEGER NOT NULL,
  "appliedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "actorName" TEXT,
  "metadata" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ThirdPartyMeasurementLegacyImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ThirdPartyMeasurementLegacyImportRow" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "measurementId" TEXT NOT NULL,
  "sourceRow" INTEGER NOT NULL,
  "payloadSha256" TEXT NOT NULL,
  "classification" TEXT NOT NULL DEFAULT 'MATCH_UNICO',
  "status" TEXT NOT NULL,
  "sourcePayload" JSONB NOT NULL,
  "previousValues" JSONB NOT NULL,
  "appliedValues" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ThirdPartyMeasurementLegacyImportRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ThirdPartyMeasurementLegacyException" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "matrixRow" INTEGER NOT NULL,
  "exceptionType" TEXT NOT NULL,
  "groupKey" TEXT,
  "sourceRowA" INTEGER,
  "sourceRowB" INTEGER,
  "contractNumber" TEXT,
  "measurementNumber" TEXT,
  "workNumber" TEXT,
  "aethosMeasurementId" TEXT,
  "fieldName" TEXT,
  "valueA" TEXT,
  "valueB" TEXT,
  "comparison" TEXT,
  "reason" TEXT,
  "proposedAction" TEXT,
  "payloadSha256A" TEXT,
  "payloadSha256B" TEXT,
  "raw" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ThirdPartyMeasurementLegacyException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ThirdPartyMeasurementLegacyImportBatch_fingerprint_key"
  ON "ThirdPartyMeasurementLegacyImportBatch"("fingerprint");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementLegacyImportBatch_status_createdAt_idx"
  ON "ThirdPartyMeasurementLegacyImportBatch"("status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ThirdPartyMeasurementLegacyImportRow_batchId_sourceRow_payloadSha256_key"
  ON "ThirdPartyMeasurementLegacyImportRow"("batchId", "sourceRow", "payloadSha256");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementLegacyImportRow_measurementId_createdAt_idx"
  ON "ThirdPartyMeasurementLegacyImportRow"("measurementId", "createdAt");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementLegacyImportRow_batchId_status_idx"
  ON "ThirdPartyMeasurementLegacyImportRow"("batchId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "ThirdPartyMeasurementLegacyException_batchId_matrixRow_key"
  ON "ThirdPartyMeasurementLegacyException"("batchId", "matrixRow");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementLegacyException_batchId_exceptionType_idx"
  ON "ThirdPartyMeasurementLegacyException"("batchId", "exceptionType");
CREATE INDEX IF NOT EXISTS "ThirdPartyMeasurementLegacyException_aethosMeasurementId_idx"
  ON "ThirdPartyMeasurementLegacyException"("aethosMeasurementId");

DO $$ BEGIN
  ALTER TABLE "ThirdPartyMeasurementLegacyImportRow"
    ADD CONSTRAINT "ThirdPartyMeasurementLegacyImportRow_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "ThirdPartyMeasurementLegacyImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ThirdPartyMeasurementLegacyImportRow"
    ADD CONSTRAINT "ThirdPartyMeasurementLegacyImportRow_measurementId_fkey"
    FOREIGN KEY ("measurementId") REFERENCES "ThirdPartyMeasurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ThirdPartyMeasurementLegacyException"
    ADD CONSTRAINT "ThirdPartyMeasurementLegacyException_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "ThirdPartyMeasurementLegacyImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Mantém as 22 colunas e tipos consumidos pelo modelo atual. O pagamento real
-- segue textual porque essa coluna não tinha tipagem explícita no Power Query legado.
CREATE OR REPLACE VIEW "bi"."medicao_terceiro_pbi" AS
SELECT
  CASE
    WHEN b.contrato_obra ~ '^[[:space:]]*[0-9]+[[:space:]]*$'
      THEN btrim(b.contrato_obra)::bigint
    ELSE NULL
  END AS "Nº Contrato",
  CASE
    WHEN b.numero_medicao ~ '^[[:space:]]*[0-9]+[[:space:]]*$'
      THEN btrim(b.numero_medicao)::bigint
    ELSE NULL
  END AS "Medição",
  b.engenheiro AS "Engenheiro",
  CASE
    WHEN b.numero_obra ~ '^[[:space:]]*[0-9]+[[:space:]]*$'
      THEN btrim(b.numero_obra)::bigint
    ELSE NULL
  END AS "Nº obra",
  b.data_entrega_eng::date AS "Data entrega eng",
  b.data_meta_entrega_eng::date AS "Data meta entrega eng",
  b.motivo_entrega_atraso AS "Motivo entrega atraso",
  CASE
    WHEN b.medicao_ok IS TRUE THEN 'Sim'
    WHEN b.medicao_ok IS FALSE THEN 'Não'
    ELSE NULL
  END AS "Medição ok?",
  b.motivo_reprovacao AS "Motivo reprovação",
  b.data_resolucao::date AS "Data resolução",
  b.data_entrega_zanandra::date AS "Data entrega Zanandra",
  b.data_solicitacao_nf::date AS "Data solicitação da NF",
  b.data_entrega_doc_empreiteiros::date AS "Data entrega de doc. Empreiteiros",
  b.data_meta_entrega_doc_empreiteiros::date AS "Data Meta entrega de doc. Empreiteiros",
  b.data_meta_solicitacao_nf::date AS "Data Meta Solicitação NF",
  b.data_meta_entrega::date AS "Data Meta entrega",
  b.tipo AS "Tipo",
  b.data_pagamento_prevista::date AS "Data Pagamento",
  b.empreiteiro AS "Empreiteiro",
  b.valor_contrato::text AS "Valor Contrato",
  m."actualPaymentDate"::date::text AS "Data Real do Pagamento",
  b.observacao_administrativa AS "Observação"
FROM "bi"."vw_pbi_medicao_terceiro" b
INNER JOIN "ThirdPartyMeasurement" m ON m."id" = b.id;

COMMENT ON VIEW "bi"."medicao_terceiro_pbi" IS
  'Compatibilidade com MEDICAO_TERC: 22 colunas legadas, origem oficial JR/Aethos e histórico administrativo auditado.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON bi.medicao_terceiro_pbi TO powerbi_reader';
  END IF;
END $$;
