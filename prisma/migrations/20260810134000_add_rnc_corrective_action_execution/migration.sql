ALTER TYPE "RncHistoryAction"
  ADD VALUE IF NOT EXISTS 'CORRECTIVE_ACTION_COMPLETED';

ALTER TABLE "RncCorrectiveAction"
  ADD COLUMN "executionNotes" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "completedById" TEXT;

ALTER TABLE "RncAttachment"
  ADD COLUMN "correctiveActionId" TEXT;

CREATE INDEX "RncCorrectiveAction_completedById_idx"
  ON "RncCorrectiveAction"("completedById");

CREATE INDEX "RncAttachment_correctiveActionId_idx"
  ON "RncAttachment"("correctiveActionId");

ALTER TABLE "RncCorrectiveAction"
  ADD CONSTRAINT "RncCorrectiveAction_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RncAttachment"
  ADD CONSTRAINT "RncAttachment_correctiveActionId_fkey"
  FOREIGN KEY ("correctiveActionId") REFERENCES "RncCorrectiveAction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE VIEW "bi"."rnc_anexos" AS
SELECT
  attachment."id",
  attachment."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  r."status"::text AS "rnc_status",
  r."obra",
  r."obraDescricao" AS "obra_descricao",
  COALESCE(NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "responsavel_engenheiro",
  attachment."fileName" AS "nome_arquivo",
  attachment."fileUrl" AS "url_arquivo",
  attachment."mimeType" AS "tipo_mime",
  attachment."sizeBytes" AS "tamanho_bytes",
  ROUND((COALESCE(attachment."sizeBytes", 0) / 1048576.0)::numeric, 2) AS "tamanho_mb",
  (attachment."mimeType" ILIKE 'image/%') AS "e_imagem",
  (attachment."mimeType" = 'application/pdf') AS "e_pdf",
  CASE
    WHEN attachment."mimeType" ILIKE 'image/%' THEN 'Imagem'
    WHEN attachment."mimeType" = 'application/pdf' THEN 'PDF'
    ELSE 'Documento'
  END AS "categoria_arquivo",
  attachment."createdAt" AS "anexado_em",
  attachment."uploadedById" AS "anexado_por_id",
  uploaded_by."name" AS "anexado_por_nome",
  uploaded_by."email" AS "anexado_por_email",
  uploaded_by."role" AS "anexado_por_perfil",
  attachment."correctiveActionId" AS "acao_corretiva_id",
  (attachment."correctiveActionId" IS NOT NULL) AS "evidencia_execucao_acao"
FROM "RncAttachment" attachment
INNER JOIN "Rnc" r ON r."id" = attachment."rncId"
LEFT JOIN "User" uploaded_by ON uploaded_by."id" = attachment."uploadedById";

CREATE OR REPLACE VIEW "bi"."rnc_acoes_corretivas" AS
SELECT
  action."id",
  action."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  r."status"::text AS "rnc_status",
  r."obra",
  r."obraDescricao" AS "obra_descricao",
  COALESCE(NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "responsavel_engenheiro",
  action."description" AS "descricao",
  action."responsible" AS "responsavel_acao",
  action."dueDate" AS "prazo",
  action."situation" AS "situacao",
  CASE
    WHEN action."situation" ILIKE 'Conclu%' THEN 'Concluida'
    WHEN action."situation" ILIKE 'Cancel%' THEN 'Cancelada'
    WHEN action."dueDate" < NOW() THEN 'Atrasada'
    WHEN action."dueDate" < NOW() + INTERVAL '5 days' THEN 'Vence em ate 5 dias'
    ELSE 'No prazo'
  END AS "situacao_prazo",
  (
    action."dueDate" < NOW()
    AND action."situation" NOT ILIKE 'Conclu%'
    AND action."situation" NOT ILIKE 'Cancel%'
  ) AS "atrasada",
  GREATEST(DATE_PART('day', NOW() - action."dueDate")::integer, 0) AS "dias_atraso",
  action."createdAt" AS "criado_em",
  action."updatedAt" AS "atualizado_em",
  action."executionNotes" AS "execucao_registrada",
  action."completedAt" AS "concluida_em",
  action."completedById" AS "concluida_por_id",
  completed_by."name" AS "concluida_por_nome",
  completed_by."email" AS "concluida_por_email",
  COUNT(evidence."id")::integer AS "qtd_evidencias"
FROM "RncCorrectiveAction" action
INNER JOIN "Rnc" r ON r."id" = action."rncId"
LEFT JOIN "User" completed_by ON completed_by."id" = action."completedById"
LEFT JOIN "RncAttachment" evidence ON evidence."correctiveActionId" = action."id"
GROUP BY action."id", r."id", completed_by."id";
