ALTER TYPE "RncStatus"
  ADD VALUE IF NOT EXISTS 'AWAITING_CAUSE_ANALYSIS';

ALTER TYPE "RncHistoryAction"
  ADD VALUE IF NOT EXISTS 'CORRECTIVE_PLAN_DECIDED';

ALTER TYPE "RncHistoryAction"
  ADD VALUE IF NOT EXISTS 'CAUSE_ANALYSIS_SUBMITTED';

ALTER TABLE "Rnc"
  ADD COLUMN IF NOT EXISTS "rootCause" TEXT,
  ADD COLUMN IF NOT EXISTS "causeFishbone" JSONB,
  ADD COLUMN IF NOT EXISTS "causeFiveWhys" JSONB;

CREATE OR REPLACE VIEW "bi"."rnc_analise_causa" AS
SELECT
  r."id" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."status"::text AS "status",
  r."needsCorrectiveActionPlan" AS "precisa_plano_acao_corretiva",
  r."nonConformityAnalysis" AS "analise_nao_conformidade",
  r."similarNonconformities" AS "existem_ncs_similares",
  r."similarNonconformitiesComment" AS "comentario_ncs_similares",
  r."causeInvestigation" AS "investigacao_causas",
  r."identifiedCauses" AS "causas_identificadas",
  r."rootCause" AS "causa_raiz",
  r."causeFishbone" AS "espinha_de_peixe",
  r."causeFiveWhys" AS "cinco_porques",
  cause_assignment."assignedToId" AS "responsavel_analise_id",
  cause_user."name" AS "responsavel_analise_nome",
  cause_user."email" AS "responsavel_analise_email",
  cause_assignment."createdAt" AS "analise_direcionada_em",
  cause_assignment."respondedAt" AS "analise_concluida_em",
  r."effectivenessReviewedAt" AS "eficacia_verificada_em",
  issuer_user."id" AS "emitente_usuario_id",
  issuer_user."name" AS "emitente_usuario_nome"
FROM "Rnc" r
INNER JOIN "User" issuer_user ON issuer_user."id" = r."engineerId"
LEFT JOIN LATERAL (
  SELECT assignment.*
  FROM "RncAssignment" assignment
  WHERE assignment."rncId" = r."id"
    AND assignment."reason" = 'Analise de causa e plano de acao corretiva'
  ORDER BY assignment."createdAt" DESC
  LIMIT 1
) cause_assignment ON TRUE
LEFT JOIN "User" cause_user ON cause_user."id" = cause_assignment."assignedToId"
WHERE r."type"::text = 'INTERNAL';

CREATE OR REPLACE VIEW "bi"."rnc_etapas_fluxo" AS
WITH raw_events AS (
  SELECT
    history."id",
    history."rncId",
    history."createdAt" AS data_inicio_etapa,
    history."actorId",
    history."action"::text AS acao_origem,
    CASE
      WHEN history."action"::text IN ('CREATED', 'RESUBMITTED')
        AND r."type"::text = 'INTERNAL' THEN 'AWAITING_RESPONSIBLE_ACTION'
      WHEN history."action"::text IN ('CREATED', 'RESUBMITTED') THEN 'PENDING_MANAGER_APPROVAL'
      WHEN history."action"::text = 'DIRECTED' THEN 'AWAITING_CAUSER_EXPLANATION'
      WHEN history."action"::text = 'EXPLANATION_SUBMITTED' THEN 'CAUSER_EXPLANATION_RECEIVED'
      WHEN history."action"::text = 'APPROVED'
        AND r."type"::text = 'INTERNAL' THEN 'AWAITING_RESPONSIBLE_ACTION'
      WHEN history."action"::text = 'APPROVED' THEN 'IN_PROGRESS'
      WHEN history."action"::text = 'CORRECTIVE_PLAN_DECIDED'
        AND r."needsCorrectiveActionPlan" IS TRUE THEN 'AWAITING_CAUSE_ANALYSIS'
      WHEN history."action"::text = 'CORRECTIVE_PLAN_DECIDED' THEN 'RESPONSIBLE_ACTION_COMPLETED'
      WHEN history."action"::text IN ('RESPONSIBLE_ACTION_SUBMITTED', 'CAUSE_ANALYSIS_SUBMITTED')
        THEN 'RESPONSIBLE_ACTION_COMPLETED'
      WHEN history."action"::text = 'EFFECTIVENESS_REVIEWED' THEN 'COMPLETED'
      WHEN history."action"::text = 'REJECTED' THEN 'REJECTED'
      WHEN history."action"::text = 'RETURNED' THEN 'RETURNED_FOR_ADJUSTMENT'
      WHEN history."action"::text = 'UPDATED_PROGRESS'
        AND (history."note" ILIKE '%conclu%' OR history."note" ILIKE '%finaliz%') THEN 'COMPLETED'
      WHEN history."action"::text = 'UPDATED_PROGRESS' THEN 'IN_PROGRESS'
      ELSE NULL
    END AS status_etapa
  FROM "RncHistory" history
  INNER JOIN "Rnc" r ON r."id" = history."rncId"
),
status_events AS (
  SELECT
    raw_events.*,
    LAG(raw_events.status_etapa) OVER (
      PARTITION BY raw_events."rncId"
      ORDER BY raw_events.data_inicio_etapa, raw_events."id"
    ) AS status_anterior
  FROM raw_events
  WHERE raw_events.status_etapa IS NOT NULL
),
collapsed AS (
  SELECT *
  FROM status_events
  WHERE status_anterior IS DISTINCT FROM status_etapa
),
sequenced AS (
  SELECT
    collapsed.*,
    ROW_NUMBER() OVER (
      PARTITION BY collapsed."rncId"
      ORDER BY collapsed.data_inicio_etapa, collapsed."id"
    ) AS ordem_etapa,
    LEAD(collapsed.data_inicio_etapa) OVER (
      PARTITION BY collapsed."rncId"
      ORDER BY collapsed.data_inicio_etapa, collapsed."id"
    ) AS data_fim_etapa
  FROM collapsed
)
SELECT
  stage."id",
  stage."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  r."obra",
  r."obraDescricao" AS "obra_descricao",
  COALESCE(NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "responsavel_engenheiro",
  stage.ordem_etapa::integer AS "ordem_etapa",
  stage.status_etapa AS "status_etapa",
  CASE stage.status_etapa
    WHEN 'PENDING_MANAGER_APPROVAL' THEN 'Aguardando aprovacao do gestor'
    WHEN 'AWAITING_CAUSER_EXPLANATION' THEN 'Aguardando explicacao do causador'
    WHEN 'CAUSER_EXPLANATION_RECEIVED' THEN 'Explicacao recebida'
    WHEN 'AWAITING_RESPONSIBLE_ACTION' THEN 'Aguardando decisao do responsavel'
    WHEN 'AWAITING_CAUSE_ANALYSIS' THEN 'Aguardando analise de causa e plano'
    WHEN 'RESPONSIBLE_ACTION_COMPLETED' THEN 'Aguardando verificacao de eficacia'
    WHEN 'RETURNED_FOR_ADJUSTMENT' THEN 'Devolvida para ajuste'
    WHEN 'REJECTED' THEN 'Reprovada'
    WHEN 'IN_PROGRESS' THEN 'Em andamento'
    WHEN 'COMPLETED' THEN 'Concluida'
    ELSE stage.status_etapa
  END AS "status_etapa_nome",
  stage.acao_origem AS "acao_origem",
  stage.data_inicio_etapa AS "data_inicio_etapa",
  stage.data_fim_etapa AS "data_fim_etapa",
  CASE
    WHEN stage.status_etapa IN ('COMPLETED', 'REJECTED') THEN 0::numeric
    ELSE ROUND((EXTRACT(EPOCH FROM (COALESCE(stage.data_fim_etapa, NOW()) - stage.data_inicio_etapa)) / 3600.0)::numeric, 2)
  END AS "horas_na_etapa",
  CASE
    WHEN stage.status_etapa IN ('COMPLETED', 'REJECTED') THEN 0
    ELSE DATE_PART('day', COALESCE(stage.data_fim_etapa, NOW()) - stage.data_inicio_etapa)::integer
  END AS "dias_na_etapa",
  (
    stage.data_fim_etapa IS NULL
    AND r."status"::text NOT IN ('COMPLETED', 'REJECTED')
  ) AS "etapa_atual",
  actor."id" AS "usuario_evento_id",
  actor."name" AS "usuario_evento_nome",
  actor."role" AS "usuario_evento_perfil",
  (stage.status_etapa IN ('COMPLETED', 'REJECTED')) AS "etapa_terminal"
FROM sequenced stage
INNER JOIN "Rnc" r ON r."id" = stage."rncId"
LEFT JOIN "User" actor ON actor."id" = stage."actorId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT SELECT ON "bi"."rnc_analise_causa" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."rnc_etapas_fluxo" TO powerbi_reader';
  END IF;
END $$;
