CREATE SCHEMA IF NOT EXISTS "bi";

CREATE OR REPLACE VIEW "bi"."vw_pbi_medicao_terceiro" AS
WITH base AS (
  SELECT
    m.*,
    CASE
      WHEN m."engineerDeliveryTargetDate" IS NULL THEN NULL
      ELSE GREATEST(
        COALESCE(m."engineerDeliveryDate"::date, CURRENT_DATE)
          - m."engineerDeliveryTargetDate"::date,
        0
      )
    END AS atraso_entrega_eng,
    CASE
      WHEN m."zanandraDeliveryTargetDate" IS NULL THEN NULL
      ELSE GREATEST(
        COALESCE(m."zanandraDeliveryDate"::date, CURRENT_DATE)
          - m."zanandraDeliveryTargetDate"::date,
        0
      )
    END AS atraso_entrega_zanandra,
    CASE
      WHEN m."invoiceRequestTargetDate" IS NULL THEN NULL
      ELSE GREATEST(
        COALESCE(m."invoiceRequestDate"::date, CURRENT_DATE)
          - m."invoiceRequestTargetDate"::date,
        0
      )
    END AS atraso_solicitacao_nf,
    CASE
      WHEN m."contractorDocumentsTargetDate" IS NULL THEN NULL
      ELSE GREATEST(
        COALESCE(m."contractorDocumentsDeliveryDate"::date, CURRENT_DATE)
          - m."contractorDocumentsTargetDate"::date,
        0
      )
    END AS atraso_documentos,
    CASE
      WHEN m."engineerDeliveryDate" IS NOT NULL THEN 'concluido'
      WHEN m."engineerDeliveryTargetDate" IS NULL THEN 'pendente'
      WHEN m."engineerDeliveryTargetDate"::date < CURRENT_DATE THEN 'atrasado'
      WHEN m."engineerDeliveryTargetDate"::date <= CURRENT_DATE + 2 THEN 'vencendo'
      ELSE 'no_prazo'
    END AS etapa_entrega_eng,
    CASE
      WHEN m."measurementApproved" IS TRUE THEN 'concluido'
      WHEN m."measurementApproved" IS FALSE AND m."resolutionDate" IS NOT NULL THEN 'resolvido'
      WHEN m."measurementApproved" IS FALSE THEN 'reprovado'
      ELSE 'pendente'
    END AS etapa_aprovacao,
    CASE
      WHEN m."zanandraDeliveryDate" IS NOT NULL THEN 'concluido'
      WHEN m."zanandraDeliveryTargetDate" IS NULL THEN 'pendente'
      WHEN m."zanandraDeliveryTargetDate"::date < CURRENT_DATE THEN 'atrasado'
      WHEN m."zanandraDeliveryTargetDate"::date <= CURRENT_DATE + 2 THEN 'vencendo'
      ELSE 'no_prazo'
    END AS etapa_zanandra,
    CASE
      WHEN m."invoiceRequestDate" IS NOT NULL THEN 'concluido'
      WHEN m."invoiceRequestTargetDate" IS NULL THEN 'pendente'
      WHEN m."invoiceRequestTargetDate"::date < CURRENT_DATE THEN 'atrasado'
      WHEN m."invoiceRequestTargetDate"::date <= CURRENT_DATE + 2 THEN 'vencendo'
      ELSE 'no_prazo'
    END AS etapa_nf,
    CASE
      WHEN m."contractorDocumentsDeliveryDate" IS NOT NULL THEN 'concluido'
      WHEN m."contractorDocumentsTargetDate" IS NULL THEN 'pendente'
      WHEN m."contractorDocumentsTargetDate"::date < CURRENT_DATE THEN 'atrasado'
      WHEN m."contractorDocumentsTargetDate"::date <= CURRENT_DATE + 2 THEN 'vencendo'
      ELSE 'no_prazo'
    END AS etapa_documentos
  FROM "ThirdPartyMeasurement" m
), calculada AS (
  SELECT
    b.*,
    CASE
      WHEN b."measurementApproved" IS FALSE AND b."resolutionDate" IS NOT NULL THEN 'resolvido'
      WHEN b."measurementApproved" IS FALSE THEN 'reprovado'
      WHEN b."engineerDeliveryDate" IS NULL THEN b.etapa_entrega_eng
      WHEN b."zanandraDeliveryDate" IS NULL THEN b.etapa_zanandra
      WHEN b."invoiceRequestDate" IS NULL THEN b.etapa_nf
      WHEN b."contractorDocumentsDeliveryDate" IS NULL THEN b.etapa_documentos
      ELSE 'concluido'
    END AS situacao_geral,
    CASE
      WHEN b."measurementApproved" IS FALSE AND b."resolutionDate" IS NOT NULL THEN 'Resolução registrada'
      WHEN b."measurementApproved" IS FALSE THEN 'Medição reprovada'
      WHEN b."engineerDeliveryDate" IS NULL THEN 'Entrega ao engenheiro'
      WHEN b."zanandraDeliveryDate" IS NULL THEN 'Entrega para Zanandra'
      WHEN b."invoiceRequestDate" IS NULL THEN 'Solicitação da NF'
      WHEN b."contractorDocumentsDeliveryDate" IS NULL THEN 'Documentos dos empreiteiros'
      ELSE 'Fluxo concluído'
    END AS etapa_corrente
  FROM base b
)
SELECT
  c."id" AS id,
  c."aethosMeasurementId" AS aethos_id_obra_contrato_medicao,
  c."aethosContractId" AS aethos_id_obra_contrato,
  c."aethosWorkId" AS aethos_id_obra,
  c."contractorAethosId" AS aethos_id_empreiteiro,
  c."engineerAethosId" AS aethos_id_engenheiro,
  c."aethosWorkId" AS numero_obra,
  c."workName" AS nome_obra,
  c."workContract" AS contrato_obra,
  c."contractorName" AS empreiteiro,
  c."engineerName" AS engenheiro,
  c."measurementNumber" AS numero_medicao,
  c."measurementDescription" AS descricao_medicao,
  c."registeredAt" AS data_cadastro_aethos,
  c."startDate" AS data_inicial,
  c."endDate" AS data_final,
  c."competenceDate" AS data_competencia,
  c."dueDate" AS data_vencimento,
  c."finalizedAt" AS data_finalizacao,
  c."dueDate" AS data_pagamento_prevista,
  c."measurementValue" AS valor_medicao,
  c."discountValue" AS valor_desconto,
  c."retentionValue" AS valor_retencao,
  c."totalValue" AS valor_total,
  c."contractValue" AS valor_contrato,
  c."totalMeasuredValue" AS valor_total_medido,
  c."contractStatus" AS status_contrato_aethos,
  c."finalized" AS finalizado_aethos,
  c."measurementNotes" AS observacao_medicao_aethos,
  c."contractNotes" AS observacao_contrato_aethos,
  c."engineerDeliveryDate" AS data_entrega_eng,
  c."engineerDeliveryTargetDate" AS data_meta_entrega_eng,
  c."engineerDelayReason" AS motivo_entrega_atraso,
  c."measurementApproved" AS medicao_ok,
  c."rejectionReason" AS motivo_reprovacao,
  c."resolutionDate" AS data_resolucao,
  c."zanandraDeliveryDate" AS data_entrega_zanandra,
  c."invoiceRequestDate" AS data_solicitacao_nf,
  c."contractorDocumentsDeliveryDate" AS data_entrega_doc_empreiteiros,
  c."zanandraDeliveryTargetDate" AS data_meta_entrega,
  c."invoiceRequestTargetDate" AS data_meta_solicitacao_nf,
  c."contractorDocumentsTargetDate" AS data_meta_entrega_doc_empreiteiros,
  c."type" AS tipo,
  c."administrativeNotes" AS observacao_administrativa,
  c.situacao_geral AS status_geral,
  c.etapa_entrega_eng AS status_entrega_eng,
  c.etapa_aprovacao AS status_aprovacao,
  c.etapa_zanandra AS status_zanandra,
  c.etapa_nf AS status_nf,
  c.etapa_documentos AS status_documentos,
  c.atraso_entrega_eng AS dias_atraso_entrega_eng,
  c.atraso_entrega_zanandra AS dias_atraso_entrega,
  c.atraso_solicitacao_nf AS dias_atraso_solicitacao_nf,
  c.atraso_documentos AS dias_atraso_documentos,
  COALESCE(c.atraso_entrega_eng, 0) > 0
    OR COALESCE(c.atraso_entrega_zanandra, 0) > 0
    OR COALESCE(c.atraso_solicitacao_nf, 0) > 0
    OR COALESCE(c.atraso_documentos, 0) > 0 AS tem_atraso,
  c.etapa_corrente AS etapa_atual,
  GREATEST(
    c."registeredAt",
    c."finalizedAt",
    c."engineerDeliveryDate",
    c."resolutionDate",
    c."zanandraDeliveryDate",
    c."invoiceRequestDate",
    c."contractorDocumentsDeliveryDate",
    c."updatedAt"
  ) AS ultima_data_movimento,
  c."source" AS origem,
  c."syncedAt" AS sincronizado_em,
  c."createdAt" AS created_at,
  c."updatedAt" AS updated_at
FROM calculada c;

CREATE OR REPLACE VIEW "bi"."vw_pbi_medicao_terceiro_detalhado" AS
SELECT
  i."id" AS id,
  i."measurementId" AS medicao_id,
  m.aethos_id_obra_contrato_medicao,
  m.aethos_id_obra_contrato,
  m.aethos_id_obra,
  i."aethosMeasurementItemId" AS aethos_id_obra_contrato_ite_med,
  i."aethosContractItemId" AS aethos_id_obra_contrato_item,
  i."aethosBudgetItemId" AS aethos_id_obra_orcamento,
  m.numero_obra,
  m.nome_obra,
  m.contrato_obra,
  m.empreiteiro,
  m.engenheiro,
  m.numero_medicao,
  m.descricao_medicao,
  m.data_competencia,
  m.data_vencimento,
  m.data_finalizacao,
  i."itemDescription" AS descricao_item,
  i."contractQuantity" AS qt_contrato,
  i."contractValue" AS valor_contrato_item,
  i."measuredQuantity" AS qt_medicao,
  i."measuredPercentage" AS percentual_medicao,
  i."measuredValue" AS valor_medicao_item,
  i."balanceQuantity" AS qt_saldo,
  i."balanceValue" AS valor_saldo,
  m.status_geral,
  m.etapa_atual,
  m.tipo,
  m.medicao_ok,
  m.tem_atraso,
  i."syncedAt" AS sincronizado_em,
  i."createdAt" AS created_at,
  i."updatedAt" AS updated_at
FROM "ThirdPartyMeasurementItem" i
INNER JOIN "bi"."vw_pbi_medicao_terceiro" m
  ON m.id = i."measurementId";

COMMENT ON VIEW "bi"."vw_pbi_medicao_terceiro" IS
  'Medição Terceiro: uma linha por medição, combinando Aethos, fluxo administrativo JR e status calculados.';
COMMENT ON VIEW "bi"."vw_pbi_medicao_terceiro_detalhado" IS
  'Medição Terceiro detalhado: uma linha por item medido, relacionado pela medição Aethos.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON bi.vw_pbi_medicao_terceiro TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON bi.vw_pbi_medicao_terceiro_detalhado TO powerbi_reader';
  END IF;
END $$;
