-- In RNCs, Rnc.responsavel is the engineer responsible for the work/RNC.
-- Rnc.engineerId identifies the authenticated user who opened the record.
-- Keep the legacy BI column names compatible, but correct their values and
-- expose the opening user explicitly.

DROP VIEW IF EXISTS "bi"."rnc_resumo_mensal";

CREATE OR REPLACE VIEW "bi"."rncs" AS
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
  COALESCE(responsible."name", r."responsavel") AS "responsavel_nome",
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
  NULL::text AS "engenheiro_id",
  r."responsavel" AS "engenheiro_nome",
  NULL::text AS "engenheiro_email",
  NULL::text AS "engenheiro_perfil",
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
  COALESCE(assignment_totals.direcionamentos_pendentes, 0) > 0 AS "tem_direcionamento_pendente",
  r."responsavel" AS "responsavel_engenheiro",
  engineer."id" AS "usuario_abertura_id",
  engineer."name" AS "usuario_abertura_nome",
  engineer."email" AS "usuario_abertura_email",
  engineer."role" AS "usuario_abertura_perfil"
FROM "Rnc" r
LEFT JOIN "User" engineer ON engineer."id" = r."engineerId"
LEFT JOIN "User" reviewer ON reviewer."id" = r."reviewedById"
LEFT JOIN "User" responsible ON responsible."id" = r."responsibleUserId"
LEFT JOIN "User" effectiveness_reviewer ON effectiveness_reviewer."id" = r."effectivenessReviewedById"
LEFT JOIN item_totals ON item_totals."rncId" = r."id"
LEFT JOIN assignment_totals ON assignment_totals."rncId" = r."id"
LEFT JOIN corrective_totals ON corrective_totals."rncId" = r."id";

CREATE OR REPLACE VIEW "bi"."rnc_direcionamentos" AS
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
  NULL::text AS "engenheiro_id",
  r."responsavel" AS "engenheiro_nome",
  r."responsavel" AS "responsavel_engenheiro",
  engineer."id" AS "usuario_abertura_id",
  engineer."name" AS "usuario_abertura_nome",
  engineer."email" AS "usuario_abertura_email",
  engineer."role" AS "usuario_abertura_perfil"
FROM "RncAssignment" assignment
INNER JOIN "Rnc" r ON r."id" = assignment."rncId"
LEFT JOIN "User" assigned_by ON assigned_by."id" = assignment."assignedById"
LEFT JOIN "User" assigned_to ON assigned_to."id" = assignment."assignedToId"
LEFT JOIN "User" engineer ON engineer."id" = r."engineerId";

CREATE VIEW "bi"."rnc_resumo_mensal" AS
SELECT
  DATE_TRUNC('month', r."createdAt")::date AS "mes",
  r."type"::text AS "tipo",
  r."status"::text AS "status",
  NULL::text AS "engenheiro_id",
  r."responsavel" AS "engenheiro_nome",
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
  SUM(COALESCE(r."valorRetidoInicial", 0) - COALESCE(r."valorRetido", 0)) AS "valor_recuperado_total",
  r."responsavel" AS "responsavel_engenheiro"
FROM "Rnc" r
GROUP BY
  DATE_TRUNC('month', r."createdAt")::date,
  r."type"::text,
  r."status"::text,
  r."responsavel";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT SELECT ON "bi"."rncs" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."rnc_direcionamentos" TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON "bi"."rnc_resumo_mensal" TO powerbi_reader';
  END IF;
END $$;
