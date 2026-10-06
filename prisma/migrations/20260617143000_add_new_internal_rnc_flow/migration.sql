-- Separate the legacy "RNC de Obra" flow from the new "RNC Interna" flow.
-- BI views depend on Rnc.type, so they must be recreated after the enum swap.
CREATE SCHEMA IF NOT EXISTS "bi";

DROP VIEW IF EXISTS "bi"."rnc_resumo_mensal";
DROP VIEW IF EXISTS "bi"."rnc_linha_tempo";
DROP VIEW IF EXISTS "bi"."rnc_itens";
DROP VIEW IF EXISTS "bi"."rnc_historico";
DROP VIEW IF EXISTS "bi"."rnc_direcionamentos";
DROP VIEW IF EXISTS "bi"."rncs";

ALTER TYPE "RncType" RENAME TO "RncType_old";
CREATE TYPE "RncType" AS ENUM ('EXTERNAL', 'WORK', 'INTERNAL');

ALTER TABLE "Rnc" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Rnc"
  ALTER COLUMN "type" TYPE "RncType"
  USING (
    CASE
      WHEN "type"::text = 'INTERNAL' THEN 'WORK'
      ELSE "type"::text
    END
  )::"RncType";
ALTER TABLE "Rnc" ALTER COLUMN "type" SET DEFAULT 'EXTERNAL';
DROP TYPE "RncType_old";

ALTER TYPE "RncStatus" ADD VALUE IF NOT EXISTS 'AWAITING_RESPONSIBLE_ACTION';
ALTER TYPE "RncStatus" ADD VALUE IF NOT EXISTS 'RESPONSIBLE_ACTION_COMPLETED';

ALTER TYPE "RncHistoryAction" ADD VALUE IF NOT EXISTS 'RESPONSIBLE_ACTION_SUBMITTED';
ALTER TYPE "RncHistoryAction" ADD VALUE IF NOT EXISTS 'EFFECTIVENESS_REVIEWED';

ALTER TABLE "Rnc"
  ADD COLUMN "ncArea" TEXT,
  ADD COLUMN "issuer" TEXT,
  ADD COLUMN "destinationSector" TEXT,
  ADD COLUMN "responsibleUserId" TEXT,
  ADD COLUMN "nonConformityDescription" TEXT,
  ADD COLUMN "nonConformityAnalysis" TEXT,
  ADD COLUMN "immediateReaction" TEXT,
  ADD COLUMN "immediateResponsible" TEXT,
  ADD COLUMN "immediateDate" TIMESTAMP(3),
  ADD COLUMN "similarNonconformities" BOOLEAN,
  ADD COLUMN "similarNonconformitiesComment" TEXT,
  ADD COLUMN "needsCorrectiveActionPlan" BOOLEAN,
  ADD COLUMN "causeInvestigation" TEXT,
  ADD COLUMN "identifiedCauses" TEXT,
  ADD COLUMN "actionsEffective" BOOLEAN,
  ADD COLUMN "actionsEffectiveNotes" TEXT,
  ADD COLUMN "requiresDocumentChange" BOOLEAN,
  ADD COLUMN "requiresDocumentChangeNotes" TEXT,
  ADD COLUMN "requiresRiskReview" BOOLEAN,
  ADD COLUMN "requiresRiskReviewNotes" TEXT,
  ADD COLUMN "effectivenessReviewedAt" TIMESTAMP(3),
  ADD COLUMN "effectivenessReviewedById" TEXT;

CREATE TABLE "RncCorrectiveAction" (
  "id" TEXT NOT NULL,
  "rncId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "responsible" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3),
  "situation" TEXT NOT NULL DEFAULT 'Pendente',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RncCorrectiveAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Rnc_responsibleUserId_idx" ON "Rnc"("responsibleUserId");
CREATE INDEX "Rnc_effectivenessReviewedById_idx" ON "Rnc"("effectivenessReviewedById");
CREATE INDEX "RncCorrectiveAction_rncId_idx" ON "RncCorrectiveAction"("rncId");
CREATE INDEX "RncCorrectiveAction_situation_idx" ON "RncCorrectiveAction"("situation");

ALTER TABLE "Rnc"
  ADD CONSTRAINT "Rnc_responsibleUserId_fkey"
  FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Rnc"
  ADD CONSTRAINT "Rnc_effectivenessReviewedById_fkey"
  FOREIGN KEY ("effectivenessReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RncCorrectiveAction"
  ADD CONSTRAINT "RncCorrectiveAction_rncId_fkey"
  FOREIGN KEY ("rncId") REFERENCES "Rnc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE VIEW "bi"."rncs" AS
WITH item_totals AS (
  SELECT
    item."rncId",
    COUNT(*)::integer AS total_itens,
    COUNT(*) FILTER (WHERE item."status" = 'INCLUDED')::integer AS itens_incluidos
  FROM "RncItem" item
  GROUP BY item."rncId"
),
assignment_totals AS (
  SELECT
    assignment."rncId",
    COUNT(*)::integer AS total_direcionamentos,
    COUNT(*) FILTER (WHERE assignment."status"::text = 'PENDING')::integer AS direcionamentos_pendentes,
    COUNT(*) FILTER (WHERE assignment."status"::text = 'ANSWERED')::integer AS direcionamentos_respondidos
  FROM "RncAssignment" assignment
  GROUP BY assignment."rncId"
),
corrective_totals AS (
  SELECT
    action."rncId",
    COUNT(*)::integer AS total_acoes_corretivas,
    COUNT(*) FILTER (WHERE action."situation" ILIKE 'Conclu%')::integer AS acoes_corretivas_concluidas
  FROM "RncCorrectiveAction" action
  GROUP BY action."rncId"
)
SELECT
  r."id",
  r."number" AS "numero",
  r."type"::text AS "tipo",
  CASE r."type"::text
    WHEN 'EXTERNAL' THEN 'RNC externa'
    WHEN 'WORK' THEN 'RNC de Obra'
    WHEN 'INTERNAL' THEN 'RNC interna'
    ELSE r."type"::text
  END AS "tipo_nome",
  r."status"::text AS "status",
  CASE r."status"::text
    WHEN 'PENDING_MANAGER_APPROVAL' THEN 'Aguardando aprovacao do gestor'
    WHEN 'AWAITING_CAUSER_EXPLANATION' THEN 'Aguardando explicacao do causador'
    WHEN 'CAUSER_EXPLANATION_RECEIVED' THEN 'Explicacao recebida'
    WHEN 'AWAITING_RESPONSIBLE_ACTION' THEN 'Aguardando acao do responsavel'
    WHEN 'RESPONSIBLE_ACTION_COMPLETED' THEN 'Acao do responsavel concluida'
    WHEN 'RETURNED_FOR_ADJUSTMENT' THEN 'Devolvida para ajuste'
    WHEN 'REJECTED' THEN 'Reprovada'
    WHEN 'IN_PROGRESS' THEN 'Em andamento'
    WHEN 'COMPLETED' THEN 'Concluida'
    ELSE r."status"::text
  END AS "status_nome",
  r."cliente",
  r."obra",
  r."obraDescricao" AS "obra_descricao",
  r."dataEntrada" AS "data_entrada",
  r."dataLimiteRetorno" AS "data_limite_retorno",
  r."etapaObra" AS "etapa_obra",
  r."enquadramentoMotivo" AS "enquadramento_motivo",
  r."valorRetidoInicial" AS "valor_retido_inicial",
  r."respondido",
  r."planoAcaoSolucao" AS "plano_acao_solucao",
  r."valorRetido" AS "valor_retido",
  COALESCE(r."valorRetidoInicial", 0) - COALESCE(r."valorRetido", 0) AS "valor_recuperado",
  r."dataAssinatura" AS "data_assinatura",
  r."obs",
  r."reviewedAt" AS "revisado_em",
  r."reviewReason" AS "motivo_revisao",
  r."requiresInvestigation" AS "necessita_investigacao",
  r."justificativasObservacoes" AS "justificativas_observacoes",
  r."internalMotivo" AS "motivo_interno",
  r."internalCausador" AS "causador_interno",
  r."internalNomeColaborador" AS "nome_colaborador",
  r."valorNc" AS "valor_nc",
  r."colocarItemSistema" AS "colocar_item_sistema",
  r."systemItemStatus" AS "status_item_sistema",
  CASE r."systemItemStatus"
    WHEN 'NOT_REQUIRED' THEN 'Nao necessario'
    WHEN 'PENDING' THEN 'Pendente'
    WHEN 'INCLUDED' THEN 'Incluido'
    ELSE r."systemItemStatus"
  END AS "status_item_sistema_nome",
  r."internalCodigoItem" AS "codigo_item",
  r."internalDescricao" AS "descricao_item",
  r."internalQuantidade" AS "quantidade_item",
  r."internalUnidadeMedida" AS "unidade_medida",
  r."internalValorUnitario" AS "valor_unitario",
  r."internalValorTotal" AS "valor_total",
  r."ncArea" AS "area_nc",
  r."issuer" AS "emitente",
  r."destinationSector" AS "setor_destino",
  r."responsibleUserId" AS "responsavel_id",
  responsible."name" AS "responsavel_nome",
  responsible."email" AS "responsavel_email",
  responsible."role" AS "responsavel_perfil",
  r."nonConformityDescription" AS "descricao_nao_conformidade",
  r."nonConformityAnalysis" AS "analise_nao_conformidade",
  r."immediateReaction" AS "reacao_imediata",
  r."immediateResponsible" AS "responsavel_reacao_imediata",
  r."immediateDate" AS "data_reacao_imediata",
  r."similarNonconformities" AS "existem_ncs_similares",
  r."similarNonconformitiesComment" AS "comentario_ncs_similares",
  r."needsCorrectiveActionPlan" AS "precisa_plano_acao_corretiva",
  r."causeInvestigation" AS "investigacao_causas",
  r."identifiedCauses" AS "causas_identificadas",
  r."actionsEffective" AS "acoes_eficazes",
  r."actionsEffectiveNotes" AS "observacao_acoes_eficazes",
  r."requiresDocumentChange" AS "precisa_alterar_documentos",
  r."requiresDocumentChangeNotes" AS "observacao_alterar_documentos",
  r."requiresRiskReview" AS "precisa_revisar_riscos",
  r."requiresRiskReviewNotes" AS "observacao_revisar_riscos",
  r."effectivenessReviewedAt" AS "eficacia_revisada_em",
  r."effectivenessReviewedById" AS "eficacia_revisada_por_id",
  effectiveness_reviewer."name" AS "eficacia_revisada_por_nome",
  COALESCE(
    item_totals.total_itens,
    CASE WHEN r."colocarItemSistema" AND r."internalDescricao" IS NOT NULL THEN 1 ELSE 0 END
  )::integer AS "itens_sistema_total",
  COALESCE(
    item_totals.itens_incluidos,
    CASE WHEN r."colocarItemSistema" AND r."systemItemStatus" = 'INCLUDED' THEN 1 ELSE 0 END
  )::integer AS "itens_sistema_incluidos",
  (
    COALESCE(
      item_totals.total_itens,
      CASE WHEN r."colocarItemSistema" AND r."internalDescricao" IS NOT NULL THEN 1 ELSE 0 END
    )
    -
    COALESCE(
      item_totals.itens_incluidos,
      CASE WHEN r."colocarItemSistema" AND r."systemItemStatus" = 'INCLUDED' THEN 1 ELSE 0 END
    )
  )::integer AS "itens_sistema_pendentes",
  COALESCE(corrective_totals.total_acoes_corretivas, 0)::integer AS "acoes_corretivas_total",
  COALESCE(corrective_totals.acoes_corretivas_concluidas, 0)::integer AS "acoes_corretivas_concluidas",
  r."photoUrl" AS "foto_url",
  r."engineerId" AS "engenheiro_id",
  engineer."name" AS "engenheiro_nome",
  engineer."email" AS "engenheiro_email",
  engineer."role" AS "engenheiro_perfil",
  r."reviewedById" AS "gestor_id",
  reviewer."name" AS "gestor_nome",
  reviewer."email" AS "gestor_email",
  reviewer."role" AS "gestor_perfil",
  r."createdAt" AS "criado_em",
  r."updatedAt" AS "atualizado_em",
  DATE_PART('day', r."dataLimiteRetorno" - NOW())::integer AS "dias_para_limite",
  DATE_PART('day', NOW() - r."createdAt")::integer AS "dias_em_aberto",
  (r."dataLimiteRetorno" < NOW() AND r."status"::text NOT IN ('COMPLETED', 'REJECTED')) AS "atrasada",
  COALESCE(assignment_totals.total_direcionamentos, 0)::integer AS "qtd_direcionamentos",
  COALESCE(assignment_totals.direcionamentos_pendentes, 0)::integer AS "qtd_direcionamentos_pendentes",
  COALESCE(assignment_totals.direcionamentos_respondidos, 0)::integer AS "qtd_direcionamentos_respondidos",
  COALESCE(assignment_totals.direcionamentos_pendentes, 0) > 0 AS "tem_direcionamento_pendente"
FROM "Rnc" r
LEFT JOIN "User" engineer ON engineer."id" = r."engineerId"
LEFT JOIN "User" reviewer ON reviewer."id" = r."reviewedById"
LEFT JOIN "User" responsible ON responsible."id" = r."responsibleUserId"
LEFT JOIN "User" effectiveness_reviewer ON effectiveness_reviewer."id" = r."effectivenessReviewedById"
LEFT JOIN item_totals ON item_totals."rncId" = r."id"
LEFT JOIN assignment_totals ON assignment_totals."rncId" = r."id"
LEFT JOIN corrective_totals ON corrective_totals."rncId" = r."id";

CREATE VIEW "bi"."rnc_itens" AS
SELECT
  item."id",
  item."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  r."status"::text AS "rnc_status",
  'RncItem' AS "origem",
  item."code" AS "codigo_item",
  item."description" AS "descricao",
  item."quantity" AS "quantidade",
  item."unit" AS "unidade_medida",
  item."unitValue" AS "valor_unitario",
  item."totalValue" AS "valor_total",
  item."status" AS "status",
  CASE item."status"
    WHEN 'PENDING' THEN 'Pendente'
    WHEN 'INCLUDED' THEN 'Incluido'
    ELSE item."status"
  END AS "status_nome",
  item."includedAt" AS "incluido_em",
  item."includedById" AS "incluido_por_id",
  included_by."name" AS "incluido_por_nome",
  included_by."email" AS "incluido_por_email",
  item."createdAt" AS "criado_em",
  item."updatedAt" AS "atualizado_em"
FROM "RncItem" item
INNER JOIN "Rnc" r ON r."id" = item."rncId"
LEFT JOIN "User" included_by ON included_by."id" = item."includedById"

UNION ALL

SELECT
  CONCAT('legacy-', r."id") AS "id",
  r."id" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  r."status"::text AS "rnc_status",
  'Legado' AS "origem",
  r."internalCodigoItem" AS "codigo_item",
  r."internalDescricao" AS "descricao",
  r."internalQuantidade" AS "quantidade",
  r."internalUnidadeMedida" AS "unidade_medida",
  r."internalValorUnitario" AS "valor_unitario",
  r."internalValorTotal" AS "valor_total",
  CASE WHEN r."systemItemStatus" = 'INCLUDED' THEN 'INCLUDED' ELSE 'PENDING' END AS "status",
  CASE WHEN r."systemItemStatus" = 'INCLUDED' THEN 'Incluido' ELSE 'Pendente' END AS "status_nome",
  r."systemItemIncludedAt" AS "incluido_em",
  r."systemItemIncludedById" AS "incluido_por_id",
  included_by."name" AS "incluido_por_nome",
  included_by."email" AS "incluido_por_email",
  r."createdAt" AS "criado_em",
  r."updatedAt" AS "atualizado_em"
FROM "Rnc" r
LEFT JOIN "User" included_by ON included_by."id" = r."systemItemIncludedById"
WHERE r."colocarItemSistema" = true
  AND r."internalDescricao" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "RncItem" item
    WHERE item."rncId" = r."id"
  );

CREATE VIEW "bi"."rnc_direcionamentos" AS
SELECT
  assignment."id",
  assignment."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  r."status"::text AS "rnc_status",
  r."cliente",
  r."obra",
  r."obraDescricao" AS "obra_descricao",
  r."internalMotivo" AS "motivo_interno",
  r."internalCausador" AS "causador_interno",
  r."requiresInvestigation" AS "necessita_investigacao",
  r."justificativasObservacoes" AS "justificativas_observacoes",
  assignment."status"::text AS "status",
  CASE assignment."status"::text
    WHEN 'PENDING' THEN 'Pendente'
    WHEN 'ANSWERED' THEN 'Respondido'
    WHEN 'CANCELLED' THEN 'Cancelado'
    ELSE assignment."status"::text
  END AS "status_nome",
  assignment."reason" AS "motivo_direcionamento",
  assignment."response" AS "resposta",
  assignment."createdAt" AS "direcionado_em",
  assignment."respondedAt" AS "respondido_em",
  assignment."updatedAt" AS "atualizado_em",
  assigned_by."id" AS "direcionado_por_id",
  assigned_by."name" AS "direcionado_por_nome",
  assigned_by."email" AS "direcionado_por_email",
  assigned_by."role" AS "direcionado_por_perfil",
  assigned_to."id" AS "direcionado_para_id",
  assigned_to."name" AS "direcionado_para_nome",
  assigned_to."email" AS "direcionado_para_email",
  assigned_to."role" AS "direcionado_para_perfil",
  engineer."id" AS "engenheiro_id",
  engineer."name" AS "engenheiro_nome"
FROM "RncAssignment" assignment
INNER JOIN "Rnc" r ON r."id" = assignment."rncId"
LEFT JOIN "User" assigned_by ON assigned_by."id" = assignment."assignedById"
LEFT JOIN "User" assigned_to ON assigned_to."id" = assignment."assignedToId"
LEFT JOIN "User" engineer ON engineer."id" = r."engineerId";

CREATE VIEW "bi"."rnc_historico" AS
SELECT
  history."id",
  history."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  r."status"::text AS "rnc_status",
  history."action"::text AS "acao",
  CASE history."action"::text
    WHEN 'CREATED' THEN 'Criada'
    WHEN 'RESUBMITTED' THEN 'Reenviada'
    WHEN 'UPDATED_PROGRESS' THEN 'Andamento atualizado'
    WHEN 'DIRECTED' THEN 'Direcionada'
    WHEN 'EXPLANATION_SUBMITTED' THEN 'Explicacao enviada'
    WHEN 'RESPONSIBLE_ACTION_SUBMITTED' THEN 'Acao do responsavel enviada'
    WHEN 'INVESTIGATION_UPDATED' THEN 'Investigacao atualizada'
    WHEN 'EFFECTIVENESS_REVIEWED' THEN 'Eficacia revisada'
    WHEN 'APPROVED' THEN 'Aprovada'
    WHEN 'REJECTED' THEN 'Reprovada'
    WHEN 'RETURNED' THEN 'Devolvida'
    ELSE history."action"::text
  END AS "acao_nome",
  history."note" AS "observacao",
  history."createdAt" AS "criado_em",
  actor."id" AS "usuario_id",
  actor."name" AS "usuario_nome",
  actor."email" AS "usuario_email",
  actor."role" AS "usuario_perfil"
FROM "RncHistory" history
INNER JOIN "Rnc" r ON r."id" = history."rncId"
LEFT JOIN "User" actor ON actor."id" = history."actorId";

CREATE VIEW "bi"."rnc_linha_tempo" AS
SELECT
  history."id",
  history."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  'HISTORICO' AS "evento_tipo",
  history."action"::text AS "evento_codigo",
  CASE history."action"::text
    WHEN 'CREATED' THEN 'RNC criada'
    WHEN 'RESUBMITTED' THEN 'RNC reenviada'
    WHEN 'UPDATED_PROGRESS' THEN 'Andamento atualizado'
    WHEN 'DIRECTED' THEN 'RNC direcionada'
    WHEN 'EXPLANATION_SUBMITTED' THEN 'Explicacao recebida'
    WHEN 'RESPONSIBLE_ACTION_SUBMITTED' THEN 'Acao do responsavel enviada'
    WHEN 'INVESTIGATION_UPDATED' THEN 'Investigacao atualizada'
    WHEN 'EFFECTIVENESS_REVIEWED' THEN 'Eficacia revisada'
    WHEN 'APPROVED' THEN 'RNC aprovada'
    WHEN 'REJECTED' THEN 'RNC reprovada'
    WHEN 'RETURNED' THEN 'RNC devolvida'
    ELSE history."action"::text
  END AS "evento_nome",
  history."note" AS "descricao",
  history."createdAt" AS "data_evento",
  actor."id" AS "usuario_id",
  actor."name" AS "usuario_nome",
  actor."email" AS "usuario_email",
  actor."role" AS "usuario_perfil",
  NULL::text AS "destino_id",
  NULL::text AS "destino_nome",
  NULL::text AS "destino_email",
  NULL::text AS "destino_perfil"
FROM "RncHistory" history
INNER JOIN "Rnc" r ON r."id" = history."rncId"
LEFT JOIN "User" actor ON actor."id" = history."actorId"

UNION ALL

SELECT
  CONCAT(assignment."id", '-direcionado') AS "id",
  assignment."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  'DIRECIONAMENTO' AS "evento_tipo",
  'DIRECTED' AS "evento_codigo",
  'Direcionamento solicitado' AS "evento_nome",
  assignment."reason" AS "descricao",
  assignment."createdAt" AS "data_evento",
  assigned_by."id" AS "usuario_id",
  assigned_by."name" AS "usuario_nome",
  assigned_by."email" AS "usuario_email",
  assigned_by."role" AS "usuario_perfil",
  assigned_to."id" AS "destino_id",
  assigned_to."name" AS "destino_nome",
  assigned_to."email" AS "destino_email",
  assigned_to."role" AS "destino_perfil"
FROM "RncAssignment" assignment
INNER JOIN "Rnc" r ON r."id" = assignment."rncId"
LEFT JOIN "User" assigned_by ON assigned_by."id" = assignment."assignedById"
LEFT JOIN "User" assigned_to ON assigned_to."id" = assignment."assignedToId"

UNION ALL

SELECT
  CONCAT(assignment."id", '-respondido') AS "id",
  assignment."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  'RESPOSTA_DIRECIONAMENTO' AS "evento_tipo",
  'ANSWERED' AS "evento_codigo",
  'Explicacao respondida' AS "evento_nome",
  assignment."response" AS "descricao",
  assignment."respondedAt" AS "data_evento",
  assigned_to."id" AS "usuario_id",
  assigned_to."name" AS "usuario_nome",
  assigned_to."email" AS "usuario_email",
  assigned_to."role" AS "usuario_perfil",
  assigned_by."id" AS "destino_id",
  assigned_by."name" AS "destino_nome",
  assigned_by."email" AS "destino_email",
  assigned_by."role" AS "destino_perfil"
FROM "RncAssignment" assignment
INNER JOIN "Rnc" r ON r."id" = assignment."rncId"
LEFT JOIN "User" assigned_by ON assigned_by."id" = assignment."assignedById"
LEFT JOIN "User" assigned_to ON assigned_to."id" = assignment."assignedToId"
WHERE assignment."respondedAt" IS NOT NULL;

CREATE VIEW "bi"."rnc_resumo_mensal" AS
SELECT
  DATE_TRUNC('month', r."createdAt")::date AS "mes",
  r."type"::text AS "tipo",
  r."status"::text AS "status",
  engineer."id" AS "engenheiro_id",
  engineer."name" AS "engenheiro_nome",
  COUNT(*)::integer AS "qtd_rncs",
  COUNT(*) FILTER (WHERE r."requiresInvestigation")::integer AS "qtd_investigacao",
  COUNT(*) FILTER (WHERE r."dataLimiteRetorno" < NOW() AND r."status"::text NOT IN ('COMPLETED', 'REJECTED'))::integer AS "qtd_atrasadas",
  COUNT(*) FILTER (WHERE r."colocarItemSistema")::integer AS "qtd_com_item_sistema",
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM "RncAssignment" assignment
      WHERE assignment."rncId" = r."id"
    )
  )::integer AS "qtd_com_direcionamento",
  COUNT(*) FILTER (WHERE r."type"::text = 'INTERNAL')::integer AS "qtd_rnc_interna_nova",
  COUNT(*) FILTER (WHERE r."status"::text = 'AWAITING_RESPONSIBLE_ACTION')::integer AS "qtd_aguardando_responsavel",
  COUNT(*) FILTER (WHERE r."status"::text = 'RESPONSIBLE_ACTION_COMPLETED')::integer AS "qtd_responsavel_concluido",
  SUM(COALESCE(r."valorNc", 0)) AS "valor_nc_total",
  SUM(COALESCE(r."valorRetidoInicial", 0)) AS "valor_retido_inicial_total",
  SUM(COALESCE(r."valorRetidoInicial", 0) - COALESCE(r."valorRetido", 0)) AS "valor_recuperado_total"
FROM "Rnc" r
LEFT JOIN "User" engineer ON engineer."id" = r."engineerId"
GROUP BY DATE_TRUNC('month', r."createdAt")::date, r."type"::text, r."status"::text, engineer."id", engineer."name";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO powerbi_reader';
  END IF;
END $$;
