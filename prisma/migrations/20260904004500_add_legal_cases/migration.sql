CREATE TABLE "LegalCase" (
    "id" UUID NOT NULL,
    "processKey" TEXT NOT NULL,
    "processNumber" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "claimantName" TEXT,
    "plaintiffName" TEXT,
    "defendantName" TEXT,
    "notificationDate" DATE,
    "lastMovementDate" DATE,
    "closedAt" DATE,
    "claimsDescription" TEXT,
    "matter" TEXT,
    "proceduralPhase" TEXT,
    "originalClaimAmount" DECIMAL(18,2),
    "riskProbability" TEXT,
    "judgmentAmount" DECIMAL(18,2),
    "finalPaidAmount" DECIMAL(18,2),
    "status" TEXT,
    "observations" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'JR_MANUAL',
    "sourceFile" TEXT,
    "sourceSheet" TEXT,
    "sourceRow" INTEGER,
    "sourceFingerprint" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegalCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalCaseAudit" (
    "id" UUID NOT NULL,
    "legalCaseId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalCaseAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalCaseImportBatch" (
    "id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "sourceFileSha256" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "exceptionCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalCaseImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalCaseImportRow" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "legalCaseId" UUID,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourcePayload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalCaseImportRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalCaseImportException" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "field" TEXT,
    "type" TEXT NOT NULL,
    "rawValue" JSONB,
    "detail" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalCaseImportException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalCase_processKey_key" ON "LegalCase"("processKey");
CREATE UNIQUE INDEX "LegalCase_sourceFingerprint_key" ON "LegalCase"("sourceFingerprint");
CREATE INDEX "LegalCase_area_status_idx" ON "LegalCase"("area", "status");
CREATE INDEX "LegalCase_company_idx" ON "LegalCase"("company");
CREATE INDEX "LegalCase_notificationDate_idx" ON "LegalCase"("notificationDate");
CREATE INDEX "LegalCase_lastMovementDate_idx" ON "LegalCase"("lastMovementDate");
CREATE INDEX "LegalCase_active_area_idx" ON "LegalCase"("active", "area");
CREATE INDEX "LegalCaseAudit_legalCaseId_changedAt_idx" ON "LegalCaseAudit"("legalCaseId", "changedAt");
CREATE INDEX "LegalCaseAudit_actorId_changedAt_idx" ON "LegalCaseAudit"("actorId", "changedAt");
CREATE UNIQUE INDEX "LegalCaseImportBatch_fingerprint_key" ON "LegalCaseImportBatch"("fingerprint");
CREATE UNIQUE INDEX "LegalCaseImportRow_batchId_sourceSheet_sourceRow_key" ON "LegalCaseImportRow"("batchId", "sourceSheet", "sourceRow");
CREATE INDEX "LegalCaseImportRow_legalCaseId_idx" ON "LegalCaseImportRow"("legalCaseId");
CREATE INDEX "LegalCaseImportException_batchId_sourceSheet_sourceRow_idx" ON "LegalCaseImportException"("batchId", "sourceSheet", "sourceRow");
CREATE INDEX "LegalCaseImportException_type_idx" ON "LegalCaseImportException"("type");

ALTER TABLE "LegalCaseAudit" ADD CONSTRAINT "LegalCaseAudit_legalCaseId_fkey"
FOREIGN KEY ("legalCaseId") REFERENCES "LegalCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegalCaseImportRow" ADD CONSTRAINT "LegalCaseImportRow_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "LegalCaseImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegalCaseImportException" ADD CONSTRAINT "LegalCaseImportException_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "LegalCaseImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE SCHEMA IF NOT EXISTS bi;

CREATE OR REPLACE VIEW bi.processos_juridicos_pbi AS
SELECT
  c."id" AS id_processo_jr,
  c."processNumber" AS numero_processo,
  c."area" AS area,
  c."company" AS empresa,
  c."claimantName" AS reclamante,
  c."plaintiffName" AS autor,
  c."defendantName" AS reu,
  c."notificationDate" AS data_notificacao,
  c."lastMovementDate" AS data_ultimo_andamento,
  c."closedAt" AS data_encerramento,
  COALESCE(c."notificationDate", c."lastMovementDate", c."closedAt") AS data_referencia,
  c."claimsDescription" AS pedidos,
  c."matter" AS materia_acao,
  c."proceduralPhase" AS fase_processual,
  c."originalClaimAmount" AS valor_original_acao,
  c."riskProbability" AS probabilidade_condenacao,
  c."judgmentAmount" AS valor_definido_juizo,
  c."finalPaidAmount" AS valor_final_pago,
  CASE WHEN c."originalClaimAmount" IS NOT NULL AND c."originalClaimAmount" <> 0
    AND c."finalPaidAmount" IS NOT NULL
    THEN ROUND((c."finalPaidAmount" / c."originalClaimAmount") * 100, 4) END AS conversao_sobre_original_pct,
  CASE WHEN c."judgmentAmount" IS NOT NULL AND c."judgmentAmount" <> 0
    AND c."finalPaidAmount" IS NOT NULL
    THEN ROUND((c."finalPaidAmount" / c."judgmentAmount") * 100, 4) END AS conversao_sobre_juizo_pct,
  c."status" AS status,
  c."observations" AS observacoes,
  c."sourceType" AS origem,
  c."sourceSheet" AS planilha_origem,
  c."sourceRow" AS linha_origem,
  c."createdAt" AS criado_em,
  c."updatedAt" AS atualizado_em
FROM "LegalCase" c
WHERE c."active" = true;

CREATE OR REPLACE VIEW bi.processos_juridicos_mensais_pbi AS
SELECT
  DATE_TRUNC('month', p.data_referencia)::date AS competencia,
  p.area,
  p.empresa,
  COUNT(*)::integer AS quantidade_processos,
  SUM(p.valor_original_acao) AS valor_original_acao,
  SUM(p.valor_definido_juizo) AS valor_definido_juizo,
  SUM(p.valor_final_pago) AS valor_final_pago,
  CASE WHEN SUM(p.valor_original_acao) FILTER (WHERE p.valor_final_pago IS NOT NULL) <> 0
    THEN ROUND((SUM(p.valor_final_pago) FILTER (WHERE p.valor_original_acao IS NOT NULL)
      / SUM(p.valor_original_acao) FILTER (WHERE p.valor_final_pago IS NOT NULL)) * 100, 4) END AS conversao_sobre_original_pct,
  CASE WHEN SUM(p.valor_definido_juizo) FILTER (WHERE p.valor_final_pago IS NOT NULL) <> 0
    THEN ROUND((SUM(p.valor_final_pago) FILTER (WHERE p.valor_definido_juizo IS NOT NULL)
      / SUM(p.valor_definido_juizo) FILTER (WHERE p.valor_final_pago IS NOT NULL)) * 100, 4) END AS conversao_sobre_juizo_pct
FROM bi.processos_juridicos_pbi p
WHERE p.data_referencia IS NOT NULL
GROUP BY DATE_TRUNC('month', p.data_referencia)::date, p.area, p.empresa;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    GRANT USAGE ON SCHEMA bi TO powerbi_reader;
    GRANT SELECT ON bi.processos_juridicos_pbi TO powerbi_reader;
    GRANT SELECT ON bi.processos_juridicos_mensais_pbi TO powerbi_reader;
  END IF;
END $$;
