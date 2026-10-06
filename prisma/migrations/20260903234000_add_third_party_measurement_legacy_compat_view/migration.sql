CREATE SCHEMA IF NOT EXISTS "bi";

-- Contrato de compatibilidade para substituir a tabela Excel MEDICAO_TERC
-- sem renomear campos, medidas ou visuais no modelo atual do Power BI.
-- A granularidade permanece uma linha por medicao oficial do Aethos/JR.
CREATE OR REPLACE VIEW "bi"."medicao_terceiro_pbi" AS
SELECT
  CASE
    WHEN b.contrato_obra ~ '^[[:space:]]*[0-9]+[[:space:]]*$'
      THEN btrim(b.contrato_obra)::bigint
    ELSE NULL
  END AS "Nº Contrato",
  CASE
    WHEN b.numero_medicao ~ '^[[:space:]]*[0-9]+[[:space:]]*$'
      THEN btrim(b.numero_medicao)::bigint
    ELSE NULL
  END AS "Medição",
  b.engenheiro AS "Engenheiro",
  CASE
    WHEN b.numero_obra ~ '^[[:space:]]*[0-9]+[[:space:]]*$'
      THEN btrim(b.numero_obra)::bigint
    ELSE NULL
  END AS "Nº obra",
  b.data_entrega_eng::date AS "Data entrega eng",
  b.data_meta_entrega_eng::date AS "Data meta entrega eng",
  b.motivo_entrega_atraso AS "Motivo entrega atraso",
  CASE
    WHEN b.medicao_ok IS TRUE THEN 'Sim'
    WHEN b.medicao_ok IS FALSE THEN 'Não'
    ELSE NULL
  END AS "Medição ok?",
  b.motivo_reprovacao AS "Motivo reprovação",
  b.data_resolucao::date AS "Data resolução",
  b.data_entrega_zanandra::date AS "Data entrega Zanandra",
  b.data_solicitacao_nf::date AS "Data solicitação da NF",
  b.data_entrega_doc_empreiteiros::date AS "Data entrega de doc. Empreiteiros",
  b.data_meta_entrega_doc_empreiteiros::date AS "Data Meta entrega de doc. Empreiteiros",
  b.data_meta_solicitacao_nf::date AS "Data Meta Solicitação NF",
  b.data_meta_entrega::date AS "Data Meta entrega",
  b.tipo AS "Tipo",
  b.data_pagamento_prevista::date AS "Data Pagamento",
  b.empreiteiro AS "Empreiteiro",
  b.valor_contrato::text AS "Valor Contrato",
  NULL::text AS "Data Real do Pagamento",
  b.observacao_administrativa AS "Observação"
FROM "bi"."vw_pbi_medicao_terceiro" b;

COMMENT ON VIEW "bi"."medicao_terceiro_pbi" IS
  'Compatibilidade com a tabela Excel MEDICAO_TERC: 22 colunas legadas, uma linha por medicao oficial do Sistema JR.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON bi.medicao_terceiro_pbi TO powerbi_reader';
  END IF;
END $$;
