CREATE SCHEMA IF NOT EXISTS "bi";

CREATE OR REPLACE VIEW "bi"."rncs" AS
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
  r."dataEntrada" AS "data_entrada",
  r."dataLimiteRetorno" AS "data_limite_retorno",
  r."etapaObra" AS "etapa_obra",
  r."enquadramentoMotivo" AS "enquadramento_motivo",
  r."valorRetidoInicial" AS "valor_retido_inicial",
  r."respondido",
  r."planoAcaoSolucao" AS "plano_acao_solucao",
  r."valorRetido" AS "valor_retido",
  r."dataAssinatura" AS "data_assinatura",
  r."obs",
  r."reviewedAt" AS "revisado_em",
  r."reviewReason" AS "motivo_revisao",
  r."internalMotivo" AS "motivo_interno",
  r."internalCausador" AS "causador_interno",
  r."internalNomeColaborador" AS "nome_colaborador",
  r."valorNc" AS "valor_nc",
  r."colocarItemSistema" AS "colocar_item_sistema",
  r."internalDescricao" AS "descricao_item",
  r."internalQuantidade" AS "quantidade_item",
  r."internalUnidadeMedida" AS "unidade_medida",
  r."internalValorUnitario" AS "valor_unitario",
  r."internalValorTotal" AS "valor_total",
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
  EXISTS (
    SELECT 1
    FROM "RncAssignment" assignment_pending
    WHERE assignment_pending."rncId" = r."id"
      AND assignment_pending."status"::text = 'PENDING'
  ) AS "tem_direcionamento_pendente"
FROM "Rnc" r
LEFT JOIN "User" engineer ON engineer."id" = r."engineerId"
LEFT JOIN "User" reviewer ON reviewer."id" = r."reviewedById";

CREATE OR REPLACE VIEW "bi"."rnc_direcionamentos" AS
SELECT
  assignment."id",
  assignment."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  r."status"::text AS "rnc_status",
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
  assigned_to."role" AS "direcionado_para_perfil"
FROM "RncAssignment" assignment
INNER JOIN "Rnc" r ON r."id" = assignment."rncId"
LEFT JOIN "User" assigned_by ON assigned_by."id" = assignment."assignedById"
LEFT JOIN "User" assigned_to ON assigned_to."id" = assignment."assignedToId";

CREATE OR REPLACE VIEW "bi"."rnc_historico" AS
SELECT
  history."id",
  history."rncId" AS "rnc_id",
  r."number" AS "rnc_numero",
  r."type"::text AS "rnc_tipo",
  history."action"::text AS "acao",
  CASE history."action"::text
    WHEN 'CREATED' THEN 'Criada'
    WHEN 'RESUBMITTED' THEN 'Reenviada'
    WHEN 'UPDATED_PROGRESS' THEN 'Andamento atualizado'
    WHEN 'DIRECTED' THEN 'Direcionada'
    WHEN 'EXPLANATION_SUBMITTED' THEN 'Explicacao enviada'
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
