BEGIN;

CREATE SCHEMA IF NOT EXISTS "bi";

DROP VIEW IF EXISTS "bi"."rnc_resumo_mensal";
DROP VIEW IF EXISTS "bi"."rnc_etapas_fluxo";
DROP VIEW IF EXISTS "bi"."rnc_acoes_corretivas";
DROP VIEW IF EXISTS "bi"."rnc_anexos";
DROP VIEW IF EXISTS "bi"."rnc_linha_tempo";
DROP VIEW IF EXISTS "bi"."rnc_historico";
DROP VIEW IF EXISTS "bi"."rnc_direcionamentos";
DROP VIEW IF EXISTS "bi"."rnc_itens";
DROP VIEW IF EXISTS "bi"."rncs";

CREATE VIEW "bi"."rncs" AS
WITH item_totals AS (
  SELECT
    item."rncId",
    COUNT(*)::integer AS total_itens,
    COUNT(*) FILTER (WHERE item."status" = 'INCLUDED')::integer AS itens_incluidos,
    SUM(COALESCE(item."totalValue", 0)) AS valor_itens_total
  FROM "RncItem" item
  GROUP BY item."rncId"
),
assignment_totals AS (
  SELECT
    assignment."rncId",
    COUNT(*)::integer AS total_direcionamentos,
    COUNT(*) FILTER (WHERE assignment."status"::text = 'PENDING')::integer AS direcionamentos_pendentes,
    COUNT(*) FILTER (WHERE assignment."status"::text = 'ANSWERED')::integer AS direcionamentos_respondidos,
    COUNT(*) FILTER (WHERE assignment."status"::text = 'CANCELLED')::integer AS direcionamentos_cancelados,
    MIN(assignment."createdAt") AS primeiro_direcionamento_em,
    MAX(assignment."respondedAt") AS ultima_resposta_em,
    AVG(EXTRACT(EPOCH FROM (assignment."respondedAt" - assignment."createdAt")) / 3600.0)
      FILTER (WHERE assignment."respondedAt" IS NOT NULL) AS media_horas_resposta
  FROM "RncAssignment" assignment
  GROUP BY assignment."rncId"
),
corrective_totals AS (
  SELECT
    action."rncId",
    COUNT(*)::integer AS total_acoes_corretivas,
    COUNT(*) FILTER (WHERE action."situation" ILIKE 'Conclu%')::integer AS acoes_corretivas_concluidas,
    COUNT(*) FILTER (
      WHERE action."dueDate" < NOW()
        AND action."situation" NOT ILIKE 'Conclu%'
        AND action."situation" NOT ILIKE 'Cancel%'
    )::integer AS acoes_corretivas_atrasadas,
    MIN(action."dueDate") FILTER (
      WHERE action."situation" NOT ILIKE 'Conclu%'
        AND action."situation" NOT ILIKE 'Cancel%'
    ) AS proximo_prazo_acao
  FROM "RncCorrectiveAction" action
  GROUP BY action."rncId"
),
attachment_totals AS (
  SELECT
    attachment."rncId",
    COUNT(*)::integer AS total_anexos,
    COUNT(*) FILTER (WHERE attachment."mimeType" ILIKE 'image/%')::integer AS anexos_imagem,
    COUNT(*) FILTER (WHERE attachment."mimeType" = 'application/pdf')::integer AS anexos_pdf,
    MIN(attachment."createdAt") AS primeiro_anexo_em,
    MAX(attachment."createdAt") AS ultimo_anexo_em
  FROM "RncAttachment" attachment
  GROUP BY attachment."rncId"
),
history_dates AS (
  SELECT
    history."rncId",
    MIN(history."createdAt") FILTER (WHERE history."action"::text = 'APPROVED') AS primeira_aprovacao_em,
    MAX(history."createdAt") FILTER (WHERE history."action"::text = 'APPROVED') AS ultima_aprovacao_em,
    MIN(history."createdAt") FILTER (WHERE history."action"::text = 'RETURNED') AS primeira_devolucao_em,
    MAX(history."createdAt") FILTER (WHERE history."action"::text = 'RETURNED') AS ultima_devolucao_em,
    MAX(history."createdAt") FILTER (WHERE history."action"::text = 'REJECTED') AS rejeitada_em,
    MAX(history."createdAt") FILTER (
      WHERE history."action"::text = 'EFFECTIVENESS_REVIEWED'
         OR (
           history."action"::text = 'UPDATED_PROGRESS'
           AND (history."note" ILIKE '%conclu%' OR history."note" ILIKE '%finaliz%')
         )
    ) AS concluida_em,
    MAX(history."createdAt") AS ultimo_evento_em,
    COUNT(*) FILTER (WHERE history."action"::text = 'RESUBMITTED')::integer AS qtd_reenvios,
    COUNT(*) FILTER (WHERE history."action"::text = 'RETURNED')::integer AS qtd_devolucoes
  FROM "RncHistory" history
  GROUP BY history."rncId"
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
    WHEN 'RESPONSIBLE_ACTION_COMPLETED' THEN 'Tratamento enviado para revisao'
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
  CASE
    WHEN r."type"::text = 'EXTERNAL'
      THEN GREATEST(COALESCE(r."valorRetidoInicial", 0) - COALESCE(r."valorRetido", 0), 0)
    ELSE 0::numeric
  END AS "valor_recuperado",
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
  COALESCE(responsible."name", NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "responsavel_nome",
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
    COALESCE(item_totals.total_itens, CASE WHEN r."colocarItemSistema" AND r."internalDescricao" IS NOT NULL THEN 1 ELSE 0 END)
    - COALESCE(item_totals.itens_incluidos, CASE WHEN r."colocarItemSistema" AND r."systemItemStatus" = 'INCLUDED' THEN 1 ELSE 0 END)
  )::integer AS "itens_sistema_pendentes",
  COALESCE(corrective_totals.total_acoes_corretivas, 0)::integer AS "acoes_corretivas_total",
  COALESCE(corrective_totals.acoes_corretivas_concluidas, 0)::integer AS "acoes_corretivas_concluidas",
  r."photoUrl" AS "foto_url",
  NULL::text AS "engenheiro_id",
  COALESCE(NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "engenheiro_nome",
  NULL::text AS "engenheiro_email",
  NULL::text AS "engenheiro_perfil",
  r."reviewedById" AS "gestor_id",
  reviewer."name" AS "gestor_nome",
  reviewer."email" AS "gestor_email",
  reviewer."role" AS "gestor_perfil",
  r."createdAt" AS "criado_em",
  r."updatedAt" AS "atualizado_em",
  DATE_PART(
    'day',
    r."dataLimiteRetorno" - COALESCE(
      CASE WHEN r."status"::text IN ('COMPLETED', 'REJECTED')
        THEN COALESCE(r."effectivenessReviewedAt", history_dates.concluida_em, history_dates.rejeitada_em, r."reviewedAt", r."updatedAt")
      END,
      NOW()
    )
  )::integer AS "dias_para_limite",
  DATE_PART(
    'day',
    COALESCE(
      CASE WHEN r."status"::text IN ('COMPLETED', 'REJECTED')
        THEN COALESCE(r."effectivenessReviewedAt", history_dates.concluida_em, history_dates.rejeitada_em, r."reviewedAt", r."updatedAt")
      END,
      NOW()
    ) - r."createdAt"
  )::integer AS "dias_em_aberto",
  (
    r."dataLimiteRetorno" < NOW()
    AND r."status"::text NOT IN ('COMPLETED', 'REJECTED')
  ) AS "atrasada",
  COALESCE(assignment_totals.total_direcionamentos, 0)::integer AS "qtd_direcionamentos",
  COALESCE(assignment_totals.direcionamentos_pendentes, 0)::integer AS "qtd_direcionamentos_pendentes",
  COALESCE(assignment_totals.direcionamentos_respondidos, 0)::integer AS "qtd_direcionamentos_respondidos",
  COALESCE(assignment_totals.direcionamentos_pendentes, 0) > 0 AS "tem_direcionamento_pendente",
  COALESCE(NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "responsavel_engenheiro",
  engineer."id" AS "usuario_abertura_id",
  engineer."name" AS "usuario_abertura_nome",
  engineer."email" AS "usuario_abertura_email",
  engineer."role" AS "usuario_abertura_perfil",

  -- Campos analiticos novos. Os campos de compatibilidade acima permanecem na mesma ordem.
  CASE WHEN r."status"::text IN ('COMPLETED', 'REJECTED') THEN false ELSE true END AS "em_aberto",
  (r."status"::text = 'COMPLETED') AS "concluida",
  (r."status"::text = 'REJECTED') AS "rejeitada",
  CASE WHEN r."status"::text IN ('COMPLETED', 'REJECTED')
    THEN COALESCE(r."effectivenessReviewedAt", history_dates.concluida_em, history_dates.rejeitada_em, r."reviewedAt", r."updatedAt")
  END AS "encerrada_em",
  history_dates.primeira_aprovacao_em AS "primeira_aprovacao_em",
  history_dates.ultima_aprovacao_em AS "ultima_aprovacao_em",
  history_dates.primeira_devolucao_em AS "primeira_devolucao_em",
  history_dates.ultima_devolucao_em AS "ultima_devolucao_em",
  history_dates.ultimo_evento_em AS "ultimo_evento_em",
  COALESCE(history_dates.qtd_reenvios, 0)::integer AS "qtd_reenvios",
  COALESCE(history_dates.qtd_devolucoes, 0)::integer AS "qtd_devolucoes",
  ROUND((EXTRACT(EPOCH FROM (history_dates.primeira_aprovacao_em - r."createdAt")) / 3600.0)::numeric, 2) AS "horas_ate_primeira_aprovacao",
  ROUND((EXTRACT(EPOCH FROM (
    COALESCE(
      CASE WHEN r."status"::text IN ('COMPLETED', 'REJECTED')
        THEN COALESCE(r."effectivenessReviewedAt", history_dates.concluida_em, history_dates.rejeitada_em, r."reviewedAt", r."updatedAt")
      END,
      NOW()
    ) - r."createdAt"
  )) / 3600.0)::numeric, 2) AS "horas_ciclo_total",
  GREATEST(
    DATE_PART(
      'day',
      COALESCE(
        CASE WHEN r."status"::text IN ('COMPLETED', 'REJECTED')
          THEN COALESCE(r."effectivenessReviewedAt", history_dates.concluida_em, history_dates.rejeitada_em, r."reviewedAt", r."updatedAt")
        END,
        NOW()
      ) - r."dataLimiteRetorno"
    )::integer,
    0
  ) AS "dias_atraso",
  (
    COALESCE(
      CASE WHEN r."status"::text IN ('COMPLETED', 'REJECTED')
        THEN COALESCE(r."effectivenessReviewedAt", history_dates.concluida_em, history_dates.rejeitada_em, r."reviewedAt", r."updatedAt")
      END,
      NOW()
    ) <= r."dataLimiteRetorno"
  ) AS "dentro_prazo",
  (
    r."status"::text IN ('COMPLETED', 'REJECTED')
    AND COALESCE(r."effectivenessReviewedAt", history_dates.concluida_em, history_dates.rejeitada_em, r."reviewedAt", r."updatedAt") > r."dataLimiteRetorno"
  ) AS "encerrada_com_atraso",
  CASE
    WHEN r."type"::text = 'WORK' THEN COALESCE(r."valorNc", item_totals.valor_itens_total, 0)
    WHEN r."type"::text = 'EXTERNAL' THEN COALESCE(r."valorRetidoInicial", 0)
    ELSE 0::numeric
  END AS "valor_referencia",
  COALESCE(item_totals.valor_itens_total, r."internalValorTotal", 0) AS "valor_itens_total",
  COALESCE(assignment_totals.direcionamentos_cancelados, 0)::integer AS "qtd_direcionamentos_cancelados",
  assignment_totals.primeiro_direcionamento_em AS "primeiro_direcionamento_em",
  assignment_totals.ultima_resposta_em AS "ultima_resposta_direcionamento_em",
  ROUND(assignment_totals.media_horas_resposta::numeric, 2) AS "media_horas_resposta_direcionamento",
  COALESCE(assignment_totals.direcionamentos_respondidos, 0) > 0 AS "tem_resposta_causador",
  COALESCE(attachment_totals.total_anexos, 0)::integer AS "anexos_total",
  COALESCE(attachment_totals.anexos_imagem, 0)::integer AS "anexos_imagem",
  COALESCE(attachment_totals.anexos_pdf, 0)::integer AS "anexos_pdf",
  attachment_totals.primeiro_anexo_em AS "primeiro_anexo_em",
  attachment_totals.ultimo_anexo_em AS "ultimo_anexo_em",
  COALESCE(corrective_totals.acoes_corretivas_atrasadas, 0)::integer AS "acoes_corretivas_atrasadas",
  corrective_totals.proximo_prazo_acao AS "proximo_prazo_acao",
  CASE
    WHEN COALESCE(corrective_totals.total_acoes_corretivas, 0) = 0 THEN NULL::numeric
    ELSE ROUND(
      (100.0 * COALESCE(corrective_totals.acoes_corretivas_concluidas, 0)
        / corrective_totals.total_acoes_corretivas)::numeric,
      2
    )
  END AS "percentual_acoes_concluidas",
  CASE
    WHEN r."status"::text IN ('COMPLETED', 'REJECTED') THEN 'Encerrada'
    WHEN r."dataLimiteRetorno" < NOW() THEN 'Atrasada'
    WHEN r."dataLimiteRetorno" < NOW() + INTERVAL '5 days' THEN 'Vence em ate 5 dias'
    ELSE 'No prazo'
  END AS "faixa_prazo"
FROM "Rnc" r
LEFT JOIN "User" engineer ON engineer."id" = r."engineerId"
LEFT JOIN "User" reviewer ON reviewer."id" = r."reviewedById"
LEFT JOIN "User" responsible ON responsible."id" = r."responsibleUserId"
LEFT JOIN "User" effectiveness_reviewer ON effectiveness_reviewer."id" = r."effectivenessReviewedById"
LEFT JOIN item_totals ON item_totals."rncId" = r."id"
LEFT JOIN assignment_totals ON assignment_totals."rncId" = r."id"
LEFT JOIN corrective_totals ON corrective_totals."rncId" = r."id"
LEFT JOIN attachment_totals ON attachment_totals."rncId" = r."id"
LEFT JOIN history_dates ON history_dates."rncId" = r."id";

CREATE VIEW "bi"."rnc_itens" AS
WITH itens AS (
  SELECT
    item."id",
    item."rncId" AS "rnc_id",
    'RncItem'::text AS "origem",
    item."code" AS "codigo_item",
    item."description" AS "descricao",
    item."quantity" AS "quantidade",
    item."unit" AS "unidade_medida",
    item."unitValue" AS "valor_unitario",
    item."totalValue" AS "valor_total",
    item."status" AS "status",
    item."includedAt" AS "incluido_em",
    item."includedById" AS "incluido_por_id",
    item."createdAt" AS "criado_em",
    item."updatedAt" AS "atualizado_em"
  FROM "RncItem" item

  UNION ALL

  SELECT
    CONCAT('legacy-', r."id") AS "id",
    r."id" AS "rnc_id",
    'Legado'::text AS "origem",
    r."internalCodigoItem" AS "codigo_item",
    r."internalDescricao" AS "descricao",
    r."internalQuantidade" AS "quantidade",
    r."internalUnidadeMedida" AS "unidade_medida",
    r."internalValorUnitario" AS "valor_unitario",
    r."internalValorTotal" AS "valor_total",
    CASE WHEN r."systemItemStatus" = 'INCLUDED' THEN 'INCLUDED' ELSE 'PENDING' END AS "status",
    r."systemItemIncludedAt" AS "incluido_em",
    r."systemItemIncludedById" AS "incluido_por_id",
    r."createdAt" AS "criado_em",
    r."updatedAt" AS "atualizado_em"
  FROM "Rnc" r
  WHERE r."colocarItemSistema" = true
    AND r."internalDescricao" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "RncItem" item WHERE item."rncId" = r."id")
)
SELECT
  itens."id",
  itens."rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  r."status"::text AS "rnc_status",
  itens."origem",
  itens."codigo_item",
  itens."descricao",
  itens."quantidade",
  itens."unidade_medida",
  itens."valor_unitario",
  itens."valor_total",
  itens."status",
  CASE itens."status"
    WHEN 'PENDING' THEN 'Pendente'
    WHEN 'INCLUDED' THEN 'Incluido'
    ELSE itens."status"
  END AS "status_nome",
  itens."incluido_em",
  itens."incluido_por_id",
  included_by."name" AS "incluido_por_nome",
  included_by."email" AS "incluido_por_email",
  itens."criado_em",
  itens."atualizado_em",
  r."obra",
  r."obraDescricao" AS "obra_descricao",
  COALESCE(NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "responsavel_engenheiro",
  CASE r."type"::text
    WHEN 'EXTERNAL' THEN 'RNC externa'
    WHEN 'WORK' THEN 'RNC de Obra'
    WHEN 'INTERNAL' THEN 'RNC interna'
    ELSE r."type"::text
  END AS "rnc_tipo_nome",
  (itens."status" = 'PENDING') AS "pendente",
  CASE WHEN itens."incluido_em" IS NOT NULL
    THEN ROUND((EXTRACT(EPOCH FROM (itens."incluido_em" - itens."criado_em")) / 3600.0)::numeric, 2)
  END AS "horas_ate_inclusao"
FROM itens
INNER JOIN "Rnc" r ON r."id" = itens."rnc_id"
LEFT JOIN "User" included_by ON included_by."id" = itens."incluido_por_id";

CREATE VIEW "bi"."rnc_direcionamentos" AS
WITH ranked AS (
  SELECT
    assignment.*,
    ROW_NUMBER() OVER (PARTITION BY assignment."rncId" ORDER BY assignment."createdAt" DESC, assignment."id" DESC) AS ordem_recente
  FROM "RncAssignment" assignment
)
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
  COALESCE(NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "engenheiro_nome",
  COALESCE(NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "responsavel_engenheiro",
  opener."id" AS "usuario_abertura_id",
  opener."name" AS "usuario_abertura_nome",
  opener."email" AS "usuario_abertura_email",
  opener."role" AS "usuario_abertura_perfil",
  (assignment.ordem_recente = 1) AS "direcionamento_mais_recente",
  ROUND((EXTRACT(EPOCH FROM (COALESCE(assignment."respondedAt", NOW()) - assignment."createdAt")) / 3600.0)::numeric, 2) AS "horas_ate_resposta",
  DATE_PART('day', COALESCE(assignment."respondedAt", NOW()) - assignment."createdAt")::integer AS "dias_ate_resposta",
  (assignment."respondedAt" IS NOT NULL) AS "foi_respondido",
  (assignment."status"::text = 'PENDING') AS "esta_pendente",
  (COALESCE(assignment."respondedAt", NOW()) <= r."dataLimiteRetorno") AS "resposta_dentro_prazo_rnc"
FROM ranked assignment
INNER JOIN "Rnc" r ON r."id" = assignment."rncId"
LEFT JOIN "User" assigned_by ON assigned_by."id" = assignment."assignedById"
LEFT JOIN "User" assigned_to ON assigned_to."id" = assignment."assignedToId"
LEFT JOIN "User" opener ON opener."id" = r."engineerId";

CREATE VIEW "bi"."rnc_historico" AS
WITH sequenced AS (
  SELECT
    history.*,
    ROW_NUMBER() OVER (PARTITION BY history."rncId" ORDER BY history."createdAt", history."id") AS ordem_evento,
    LAG(history."createdAt") OVER (PARTITION BY history."rncId" ORDER BY history."createdAt", history."id") AS evento_anterior_em
  FROM "RncHistory" history
)
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
    WHEN 'RESPONSIBLE_ACTION_SUBMITTED' THEN 'Tratamento enviado pelo responsavel'
    WHEN 'EFFECTIVENESS_REVIEWED' THEN 'Eficacia revisada'
    WHEN 'INVESTIGATION_UPDATED' THEN 'Investigacao atualizada'
    WHEN 'ATTACHMENT_ADDED' THEN 'Anexo adicionado'
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
  actor."role" AS "usuario_perfil",
  history.ordem_evento::integer AS "ordem_evento",
  history.evento_anterior_em AS "evento_anterior_em",
  CASE WHEN history.evento_anterior_em IS NOT NULL
    THEN ROUND((EXTRACT(EPOCH FROM (history."createdAt" - history.evento_anterior_em)) / 3600.0)::numeric, 2)
  END AS "horas_desde_evento_anterior",
  r."obra",
  r."obraDescricao" AS "obra_descricao",
  COALESCE(NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "responsavel_engenheiro",
  opener."id" AS "usuario_abertura_id",
  opener."name" AS "usuario_abertura_nome"
FROM sequenced history
INNER JOIN "Rnc" r ON r."id" = history."rncId"
LEFT JOIN "User" actor ON actor."id" = history."actorId"
LEFT JOIN "User" opener ON opener."id" = r."engineerId";

CREATE VIEW "bi"."rnc_linha_tempo" AS
WITH sequenced AS (
  SELECT
    history.*,
    ROW_NUMBER() OVER (PARTITION BY history."rncId" ORDER BY history."createdAt", history."id") AS ordem_evento,
    LEAD(history."createdAt") OVER (PARTITION BY history."rncId" ORDER BY history."createdAt", history."id") AS proximo_evento_em
  FROM "RncHistory" history
),
enriched AS (
  SELECT
    history.*,
    directed_assignment."assignedToId" AS direcionado_para_id,
    response_assignment."assignedById" AS resposta_para_id
  FROM sequenced history
  LEFT JOIN LATERAL (
    SELECT assignment."assignedToId"
    FROM "RncAssignment" assignment
    WHERE history."action"::text = 'DIRECTED'
      AND assignment."rncId" = history."rncId"
    ORDER BY ABS(EXTRACT(EPOCH FROM (assignment."createdAt" - history."createdAt")))
    LIMIT 1
  ) directed_assignment ON TRUE
  LEFT JOIN LATERAL (
    SELECT assignment."assignedById"
    FROM "RncAssignment" assignment
    WHERE history."action"::text = 'EXPLANATION_SUBMITTED'
      AND assignment."rncId" = history."rncId"
      AND assignment."respondedAt" IS NOT NULL
    ORDER BY ABS(EXTRACT(EPOCH FROM (assignment."respondedAt" - history."createdAt")))
    LIMIT 1
  ) response_assignment ON TRUE
)
SELECT
  history."id",
  history."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  'HISTORICO'::text AS "evento_tipo",
  history."action"::text AS "evento_codigo",
  CASE history."action"::text
    WHEN 'CREATED' THEN 'RNC criada'
    WHEN 'RESUBMITTED' THEN 'RNC reenviada'
    WHEN 'UPDATED_PROGRESS' THEN 'Andamento atualizado'
    WHEN 'DIRECTED' THEN 'RNC direcionada'
    WHEN 'EXPLANATION_SUBMITTED' THEN 'Explicacao recebida'
    WHEN 'RESPONSIBLE_ACTION_SUBMITTED' THEN 'Tratamento enviado pelo responsavel'
    WHEN 'EFFECTIVENESS_REVIEWED' THEN 'Revisao de eficacia concluida'
    WHEN 'INVESTIGATION_UPDATED' THEN 'Investigacao atualizada'
    WHEN 'ATTACHMENT_ADDED' THEN 'Anexo adicionado'
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
  destination."id" AS "destino_id",
  destination."name" AS "destino_nome",
  destination."email" AS "destino_email",
  destination."role" AS "destino_perfil",
  history.ordem_evento::integer AS "ordem_evento",
  history.proximo_evento_em AS "proximo_evento_em",
  CASE WHEN history.proximo_evento_em IS NOT NULL
    THEN ROUND((EXTRACT(EPOCH FROM (history.proximo_evento_em - history."createdAt")) / 3600.0)::numeric, 2)
  END AS "horas_ate_proximo_evento",
  (history.proximo_evento_em IS NULL) AS "ultimo_evento",
  r."obra",
  r."obraDescricao" AS "obra_descricao",
  COALESCE(NULLIF(BTRIM(r."responsavel"), ''), 'Sem responsavel') AS "responsavel_engenheiro"
FROM enriched history
INNER JOIN "Rnc" r ON r."id" = history."rncId"
LEFT JOIN "User" actor ON actor."id" = history."actorId"
LEFT JOIN "User" destination
  ON destination."id" = COALESCE(history.direcionado_para_id, history.resposta_para_id);

CREATE VIEW "bi"."rnc_anexos" AS
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
  uploaded_by."role" AS "anexado_por_perfil"
FROM "RncAttachment" attachment
INNER JOIN "Rnc" r ON r."id" = attachment."rncId"
LEFT JOIN "User" uploaded_by ON uploaded_by."id" = attachment."uploadedById";

CREATE VIEW "bi"."rnc_acoes_corretivas" AS
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
  action."updatedAt" AS "atualizado_em"
FROM "RncCorrectiveAction" action
INNER JOIN "Rnc" r ON r."id" = action."rncId";

CREATE VIEW "bi"."rnc_etapas_fluxo" AS
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
    ROW_NUMBER() OVER (PARTITION BY collapsed."rncId" ORDER BY collapsed.data_inicio_etapa, collapsed."id") AS ordem_etapa,
    LEAD(collapsed.data_inicio_etapa) OVER (PARTITION BY collapsed."rncId" ORDER BY collapsed.data_inicio_etapa, collapsed."id") AS data_fim_etapa
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
  ROUND((EXTRACT(EPOCH FROM (COALESCE(stage.data_fim_etapa, NOW()) - stage.data_inicio_etapa)) / 3600.0)::numeric, 2) AS "horas_na_etapa",
  DATE_PART('day', COALESCE(stage.data_fim_etapa, NOW()) - stage.data_inicio_etapa)::integer AS "dias_na_etapa",
  (stage.data_fim_etapa IS NULL) AS "etapa_atual",
  actor."id" AS "usuario_evento_id",
  actor."name" AS "usuario_evento_nome",
  actor."role" AS "usuario_evento_perfil"
FROM sequenced stage
INNER JOIN "Rnc" r ON r."id" = stage."rncId"
LEFT JOIN "User" actor ON actor."id" = stage."actorId";

CREATE VIEW "bi"."rnc_resumo_mensal" AS
SELECT
  DATE_TRUNC('month', r."criado_em")::date AS "mes",
  r."tipo",
  r."status",
  NULL::text AS "engenheiro_id",
  r."responsavel_engenheiro" AS "engenheiro_nome",
  COUNT(*)::integer AS "qtd_rncs",
  COUNT(*) FILTER (WHERE r."necessita_investigacao")::integer AS "qtd_investigacao",
  COUNT(*) FILTER (WHERE r."atrasada")::integer AS "qtd_atrasadas",
  COUNT(*) FILTER (WHERE r."colocar_item_sistema")::integer AS "qtd_com_item_sistema",
  COUNT(*) FILTER (WHERE r."qtd_direcionamentos" > 0)::integer AS "qtd_com_direcionamento",
  COUNT(*) FILTER (WHERE r."tipo" = 'INTERNAL')::integer AS "qtd_rnc_interna_nova",
  COUNT(*) FILTER (WHERE r."status" = 'AWAITING_RESPONSIBLE_ACTION')::integer AS "qtd_aguardando_responsavel",
  COUNT(*) FILTER (WHERE r."status" = 'RESPONSIBLE_ACTION_COMPLETED')::integer AS "qtd_responsavel_concluido",
  SUM(COALESCE(r."valor_nc", 0)) AS "valor_nc_total",
  SUM(COALESCE(r."valor_retido_inicial", 0)) AS "valor_retido_inicial_total",
  SUM(COALESCE(r."valor_recuperado", 0)) AS "valor_recuperado_total",
  r."responsavel_engenheiro",
  COUNT(*) FILTER (WHERE r."em_aberto")::integer AS "qtd_em_aberto",
  COUNT(*) FILTER (WHERE r."concluida")::integer AS "qtd_concluidas",
  COUNT(*) FILTER (WHERE r."rejeitada")::integer AS "qtd_rejeitadas",
  COUNT(*) FILTER (WHERE r."qtd_devolucoes" > 0)::integer AS "qtd_devolvidas",
  SUM(COALESCE(r."valor_referencia", 0)) AS "valor_referencia_total",
  SUM(COALESCE(r."itens_sistema_total", 0))::integer AS "itens_sistema_total",
  SUM(COALESCE(r."itens_sistema_pendentes", 0))::integer AS "itens_sistema_pendentes",
  SUM(COALESCE(r."anexos_total", 0))::integer AS "anexos_total",
  SUM(COALESCE(r."anexos_imagem", 0))::integer AS "anexos_imagem",
  SUM(COALESCE(r."acoes_corretivas_total", 0))::integer AS "acoes_corretivas_total",
  SUM(COALESCE(r."acoes_corretivas_atrasadas", 0))::integer AS "acoes_corretivas_atrasadas",
  ROUND(AVG(r."horas_ate_primeira_aprovacao")::numeric, 2) AS "media_horas_ate_aprovacao",
  ROUND(AVG(r."horas_ciclo_total")::numeric, 2) AS "media_horas_ciclo",
  ROUND((100.0 * COUNT(*) FILTER (WHERE r."dentro_prazo") / NULLIF(COUNT(*), 0))::numeric, 2) AS "percentual_dentro_prazo"
FROM "bi"."rncs" r
GROUP BY
  DATE_TRUNC('month', r."criado_em")::date,
  r."tipo",
  r."status",
  r."responsavel_engenheiro";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO powerbi_reader';
  END IF;
END $$;

COMMIT;
