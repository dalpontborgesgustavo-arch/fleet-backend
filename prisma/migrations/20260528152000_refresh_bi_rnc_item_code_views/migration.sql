CREATE SCHEMA IF NOT EXISTS "bi";

DROP VIEW IF EXISTS "bi"."rnc_itens";
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
  r."internalCodigoItem" AS "codigo_item",
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO powerbi_reader';
  END IF;
END $$;
