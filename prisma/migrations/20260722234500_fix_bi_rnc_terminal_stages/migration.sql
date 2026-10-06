CREATE OR REPLACE VIEW "bi"."rnc_etapas_fluxo" AS
WITH raw_events AS (
  SELECT
    history."id",
    history."rncId",
    history."createdAt" AS data_inicio_etapa,
    history."actorId",
    history."action"::text AS acao_origem,
    CASE
      WHEN history."action"::text IN ('CREATED', 'RESUBMITTED') THEN 'PENDING_MANAGER_APPROVAL'
      WHEN history."action"::text = 'DIRECTED' THEN 'AWAITING_CAUSER_EXPLANATION'
      WHEN history."action"::text = 'EXPLANATION_SUBMITTED' THEN 'CAUSER_EXPLANATION_RECEIVED'
      WHEN history."action"::text = 'APPROVED' AND r."type"::text = 'INTERNAL' THEN 'AWAITING_RESPONSIBLE_ACTION'
      WHEN history."action"::text = 'APPROVED' THEN 'IN_PROGRESS'
      WHEN history."action"::text = 'RESPONSIBLE_ACTION_SUBMITTED' THEN 'RESPONSIBLE_ACTION_COMPLETED'
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
    WHEN 'AWAITING_RESPONSIBLE_ACTION' THEN 'Aguardando acao do responsavel'
    WHEN 'RESPONSIBLE_ACTION_COMPLETED' THEN 'Tratamento enviado para revisao'
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
    EXECUTE 'GRANT SELECT ON "bi"."rnc_etapas_fluxo" TO powerbi_reader';
  END IF;
END $$;
