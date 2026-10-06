CREATE SCHEMA IF NOT EXISTS "bi";

DROP VIEW IF EXISTS "bi"."rnc_resumo_mensal";
DROP VIEW IF EXISTS "bi"."rnc_linha_tempo";
DROP VIEW IF EXISTS "bi"."rnc_itens";
DROP VIEW IF EXISTS "bi"."rnc_historico";
DROP VIEW IF EXISTS "bi"."rnc_direcionamentos";
DROP VIEW IF EXISTS "bi"."rncs";

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
)
SELECT
  r."id",
  r."number" AS "numero",
  r."type"::text AS "tipo",
  CASE r."type"::text
    WHEN 'EXTERNAL' THEN 'RNC externa'
    WHEN 'INTERNAL' THEN 'RNC interna'
    ELSE r."type"::text
  END AS "tipo_nome",
  r."status"::text AS "status",
  CASE r."status"::text
    WHEN 'PENDING_MANAGER_APPROVAL' THEN 'Aguardando aprovacao do gestor'
    WHEN 'AWAITING_CAUSER_EXPLANATION' THEN 'Aguardando explicacao do causador'
    WHEN 'CAUSER_EXPLANATION_RECEIVED' THEN 'Explicacao recebida'
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
  r."internalDescricao" AS "descricao_item",
  r."internalQuantidade" AS "quantidade_item",
  r."internalUnidadeMedida" AS "unidade_medida",
  r."internalValorUnitario" AS "valor_unitario",
  r."internalValorTotal" AS "valor_total",
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
LEFT JOIN item_totals ON item_totals."rncId" = r."id"
LEFT JOIN assignment_totals ON assignment_totals."rncId" = r."id";

CREATE VIEW "bi"."rnc_itens" AS
SELECT
  item."id",
  item."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  r."status"::text AS "rnc_status",
  'RncItem' AS "origem",
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
    WHEN 'INVESTIGATION_UPDATED' THEN 'Investigacao atualizada'
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
    WHEN 'INVESTIGATION_UPDATED' THEN 'Investigacao atualizada'
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
