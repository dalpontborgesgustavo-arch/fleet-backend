-- Separa obra nova e aditivo, fixa a meta total em 5 dias úteis desde o e-mail
-- e expõe as etapas por setor sem perder o histórico importado.

UPDATE "CommercialProcessRecord"
SET "route" = CASE
  WHEN UPPER(TRANSLATE(COALESCE("launchType", ''), 'ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ', 'AAAAEEEIIIOOOOUUUC')) LIKE '%ADITIVO%'
    THEN 'INSERCAO_ADITIVO_SISTEMA'
  ELSE 'INSERCAO_OBRA_NOVA_SISTEMA'
END
WHERE "route" = 'INSERCAO_OBRA_SISTEMA';

UPDATE "CommercialProcessRecord" p
SET
  "launchType" = CASE
    WHEN p."route" = 'INSERCAO_ADITIVO_SISTEMA' THEN 'ADITIVO'
    ELSE 'OBRA NOVA'
  END,
  "responsible" = CASE
    WHEN p."route" = 'INSERCAO_ADITIVO_SISTEMA' THEN 'Administrativo → Orçamento'
    ELSE 'Orçamento'
  END,
  "startDate" = p."launchEmailSentAt",
  "plannedBusinessDays" = 5,
  "dueDate" = CASE
    WHEN p."launchEmailSentAt" IS NULL THEN NULL
    ELSE p."launchEmailSentAt" + (
      SELECT day_offset::integer
      FROM generate_series(1, 14) AS offsets(day_offset)
      WHERE EXTRACT(ISODOW FROM p."launchEmailSentAt" + day_offset::integer) <= 5
      ORDER BY day_offset
      OFFSET 4 LIMIT 1
    )
  END,
  "elapsedCalendarDays" = CASE
    WHEN p."launchEmailSentAt" IS NULL
      OR p."completedDate" IS NULL
      OR p."completedDate" < p."launchEmailSentAt"
      THEN NULL
    ELSE p."completedDate" - p."launchEmailSentAt"
  END,
  "elapsedBusinessDays" = CASE
    WHEN p."launchEmailSentAt" IS NULL
      OR p."completedDate" IS NULL
      OR p."completedDate" < p."launchEmailSentAt"
      THEN NULL
    ELSE (
      SELECT COUNT(*)::integer
      FROM generate_series(
        p."launchEmailSentAt" + 1,
        p."completedDate",
        INTERVAL '1 day'
      ) AS business_days(day)
      WHERE EXTRACT(ISODOW FROM business_days.day) <= 5
    )
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE p."route" IN (
  'INSERCAO_OBRA_NOVA_SISTEMA',
  'INSERCAO_ADITIVO_SISTEMA'
);

CREATE OR REPLACE VIEW "bi"."comercial_prazos" AS
SELECT
  p."id" AS "ID_REGISTRO", p."route" AS "ROTA", p."competition" AS "CONCORRENCIA",
  p."contractNumber" AS "CONTRATO", p."contractingParty" AS "CONTRATANTE",
  p."launchType" AS "TIPO_LANCAMENTO", p."requester" AS "SOLICITANTE",
  p."objectSummary" AS "RESUMO_OBJETO", p."client" AS "CLIENTE",
  p."complexity" AS "COMPLEXIDADE", p."filledAt" AS "DATA_PREENCHIMENTO",
  p."contractSignedSentAt" AS "DATA_ENVIO_CONTRATO_ASSINADO",
  p."launchEmailSentAt" AS "DATA_ENVIO_EMAIL_LANCAMENTO",
  p."workOpenedAt" AS "DATA_ABERTURA_OBRA",
  p."registrationConsultSentAt" AS "DATA_CONSULTA_CADASTRO",
  p."registrationReturnedAt" AS "DATA_RETORNO_CADASTRO",
  p."documentsSentAt" AS "DATA_ENVIO_DOCUMENTOS", p."startDate" AS "DATA_INICIO",
  p."plannedBusinessDays" AS "PRAZO_DIAS_UTEIS", p."dueDate" AS "DATA_LIMITE",
  p."completedDate" AS "DATA_CONCLUSAO", p."elapsedCalendarDays" AS "DIAS_CORRIDOS",
  p."elapsedBusinessDays" AS "PRAZO_REALIZADO_DIAS_UTEIS",
  CASE WHEN p."startDate" IS NULL THEN 'Não iniciado' WHEN p."completedDate" IS NULL THEN 'Em andamento' WHEN p."completedDate" < p."startDate" THEN 'Inconsistente' ELSE 'Concluído' END AS "STATUS_CALCULADO",
  CASE WHEN p."completedDate" IS NULL OR p."dueDate" IS NULL THEN NULL ELSE p."completedDate" <= p."dueDate" END AS "DENTRO_PRAZO",
  p."responsible" AS "RESPONSAVEL", p."notes" AS "OBSERVACOES", p."sourceType" AS "ORIGEM_DADO",
  p."createdAt" AS "CRIADO_EM", p."updatedAt" AS "ATUALIZADO_EM",
  CASE WHEN p."route" = 'INSERCAO_ADITIVO_SISTEMA' THEN p."launchEmailSentAt" END AS "ETAPA_ADMINISTRATIVO_INICIO",
  CASE WHEN p."route" = 'INSERCAO_ADITIVO_SISTEMA' THEN p."workOpenedAt" END AS "ETAPA_ADMINISTRATIVO_FIM",
  CASE
    WHEN p."route" = 'INSERCAO_OBRA_NOVA_SISTEMA' THEN p."launchEmailSentAt"
    WHEN p."route" = 'INSERCAO_ADITIVO_SISTEMA' THEN p."workOpenedAt"
  END AS "ETAPA_ORCAMENTO_INICIO",
  CASE WHEN p."route" IN ('INSERCAO_OBRA_NOVA_SISTEMA', 'INSERCAO_ADITIVO_SISTEMA') THEN p."completedDate" END AS "ETAPA_ORCAMENTO_FIM",
  CASE WHEN p."route" IN ('INSERCAO_OBRA_NOVA_SISTEMA', 'INSERCAO_ADITIVO_SISTEMA') THEN 5 END AS "META_TOTAL_DIAS_UTEIS"
FROM "CommercialProcessRecord" p WHERE p."active" = TRUE;

CREATE OR REPLACE VIEW "bi"."comercial_indicadores_tempos_pbi" AS
SELECT
  p."id" AS "ID_Registro",
  p."route" AS "Rota",
  p."competition" AS "Concorrencia",
  p."contractNumber" AS "Contrato",
  COALESCE(p."contractingParty", p."client") AS "Cliente_Contratante",
  p."objectSummary" AS "Obra_Nome",
  CASE p."route"
    WHEN 'EMISSAO_ART' THEN 'Emissão de ART'
    WHEN 'INSERCAO_OBRA_NOVA_SISTEMA' THEN 'Inserção de obra nova no sistema'
    WHEN 'INSERCAO_ADITIVO_SISTEMA' THEN 'Inserção de aditivo no sistema'
    WHEN 'RETORNO_ORCAMENTO_PARTICULAR' THEN 'Retorno de orçamento particular'
  END AS "Tema_Indicador",
  p."launchType" AS "Tipo_Lancamento",
  p."complexity" AS "Porte_Obra",
  p."filledAt" AS "Data_Preenchimento",
  p."startDate" AS "Data_Inicio",
  p."dueDate" AS "Data_Limite",
  p."completedDate" AS "Data_Fim",
  p."plannedBusinessDays" AS "Prazo_Dias_Uteis",
  CASE WHEN p."completedDate" < p."startDate" THEN NULL ELSE p."elapsedCalendarDays" END AS "Tempo_Dias_Corridos",
  CASE WHEN p."completedDate" < p."startDate" THEN NULL ELSE p."elapsedBusinessDays" END AS "Tempo_Dias_Uteis",
  p."responsible" AS "Responsavel",
  p."notes" AS "Observacoes",
  TO_CHAR(p."startDate", 'YYYY-MM') AS "Mes_Ano_Inicio",
  EXTRACT(YEAR FROM p."startDate")::integer AS "Ano_Inicio",
  CASE WHEN p."startDate" IS NULL THEN 'Não iniciado' WHEN p."completedDate" IS NULL THEN 'Em andamento' WHEN p."completedDate" < p."startDate" THEN 'Inconsistente' ELSE 'Concluído' END AS "Status_Calculado",
  CASE WHEN p."route" IS NOT NULL AND p."startDate" IS NOT NULL AND p."completedDate" IS NOT NULL AND p."completedDate" >= p."startDate" THEN 1 ELSE 0 END AS "Registro_Valido",
  CASE WHEN p."route" IS NULL THEN 'Informar rota' WHEN p."startDate" IS NULL THEN 'Preencher início' WHEN p."completedDate" IS NULL THEN 'Preencher fim' WHEN p."completedDate" < p."startDate" THEN 'Fim antes do início' ELSE 'OK' END AS "Alerta_Preenchimento",
  p."contractSignedSentAt" AS "Data_Envio_Contrato_Assinado",
  p."launchEmailSentAt" AS "Data_Envio_Email_Lancamento",
  p."workOpenedAt" AS "Data_Abertura_Obra",
  p."registrationConsultSentAt" AS "Data_Consulta_Cadastro",
  p."registrationReturnedAt" AS "Data_Retorno_Cadastro",
  p."documentsSentAt" AS "Data_Envio_Documentos",
  p."requester" AS "Solicitante",
  p."sourceType" AS "Origem_Dado",
  p."updatedAt" AS "Atualizado_Em",
  CASE WHEN p."route" = 'INSERCAO_ADITIVO_SISTEMA' THEN p."launchEmailSentAt" END AS "Data_Inicio_Administrativo",
  CASE WHEN p."route" = 'INSERCAO_ADITIVO_SISTEMA' THEN p."workOpenedAt" END AS "Data_Fim_Administrativo",
  CASE
    WHEN p."route" = 'INSERCAO_ADITIVO_SISTEMA'
      AND p."launchEmailSentAt" IS NOT NULL
      AND p."workOpenedAt" IS NOT NULL
      AND p."workOpenedAt" >= p."launchEmailSentAt"
    THEN (
      SELECT COUNT(*)::integer
      FROM generate_series(p."launchEmailSentAt" + 1, p."workOpenedAt", INTERVAL '1 day') AS days(day)
      WHERE EXTRACT(ISODOW FROM days.day) <= 5
    )
  END AS "Tempo_Administrativo_Dias_Uteis",
  CASE
    WHEN p."route" = 'INSERCAO_OBRA_NOVA_SISTEMA' THEN p."launchEmailSentAt"
    WHEN p."route" = 'INSERCAO_ADITIVO_SISTEMA' THEN p."workOpenedAt"
  END AS "Data_Inicio_Orcamento",
  CASE WHEN p."route" IN ('INSERCAO_OBRA_NOVA_SISTEMA', 'INSERCAO_ADITIVO_SISTEMA') THEN p."completedDate" END AS "Data_Fim_Orcamento",
  CASE
    WHEN p."route" IN ('INSERCAO_OBRA_NOVA_SISTEMA', 'INSERCAO_ADITIVO_SISTEMA')
      AND p."completedDate" IS NOT NULL
      AND (CASE WHEN p."route" = 'INSERCAO_OBRA_NOVA_SISTEMA' THEN p."launchEmailSentAt" ELSE p."workOpenedAt" END) IS NOT NULL
      AND p."completedDate" >= (CASE WHEN p."route" = 'INSERCAO_OBRA_NOVA_SISTEMA' THEN p."launchEmailSentAt" ELSE p."workOpenedAt" END)
    THEN (
      SELECT COUNT(*)::integer
      FROM generate_series(
        (CASE WHEN p."route" = 'INSERCAO_OBRA_NOVA_SISTEMA' THEN p."launchEmailSentAt" ELSE p."workOpenedAt" END) + 1,
        p."completedDate",
        INTERVAL '1 day'
      ) AS days(day)
      WHERE EXTRACT(ISODOW FROM days.day) <= 5
    )
  END AS "Tempo_Orcamento_Dias_Uteis",
  CASE WHEN p."route" IN ('INSERCAO_OBRA_NOVA_SISTEMA', 'INSERCAO_ADITIVO_SISTEMA') THEN 5 END AS "Meta_Total_Dias_Uteis",
  CASE
    WHEN p."route" = 'INSERCAO_OBRA_NOVA_SISTEMA' THEN 1
    WHEN p."route" = 'INSERCAO_ADITIVO_SISTEMA' THEN 2
  END AS "Quantidade_Etapas"
FROM "CommercialProcessRecord" p WHERE p."active" = TRUE;

CREATE OR REPLACE VIEW "bi"."comercial_indicadores_config_pbi" AS
SELECT * FROM (VALUES
  ('EMISSAO_ART', 'Emissão de ART', 1, 'contractSignedSentAt', 'completedDate', 'contractSignedSentAt', NULL::integer, TRUE, DATE '2026-01-01', NULL::date, NULL::text, NULL::integer),
  ('INSERCAO_OBRA_NOVA_SISTEMA', 'Inserção de obra nova no sistema', 2, 'launchEmailSentAt', 'completedDate', 'launchEmailSentAt', 5, TRUE, DATE '2026-01-01', NULL::date, 'Orçamento', 1),
  ('INSERCAO_ADITIVO_SISTEMA', 'Inserção de aditivo no sistema', 3, 'launchEmailSentAt', 'completedDate', 'launchEmailSentAt', 5, TRUE, DATE '2026-01-01', NULL::date, 'Administrativo → Orçamento', 2),
  ('RETORNO_ORCAMENTO_PARTICULAR', 'Retorno de orçamento particular', 4, 'documentsSentAt', 'completedDate', 'documentsSentAt', NULL::integer, TRUE, DATE '2026-01-01', NULL::date, NULL::text, NULL::integer)
) AS cfg("ROTA", "ROTULO", "ORDEM", "CAMPO_INICIO", "CAMPO_FIM", "CAMPO_GERADOR_LIMITE", "PRAZO_PADRAO_DIAS_UTEIS", "ATIVA", "VIGENCIA_INICIO", "VIGENCIA_FIM", "SETORES", "QUANTIDADE_ETAPAS");

CREATE OR REPLACE VIEW "bi"."comercial_indicadores_mensais" AS
SELECT DATE_TRUNC('month', "DATA_INICIO")::date AS "COMPETENCIA", "ROTA",
       COUNT(*) AS "TOTAL_REGISTROS",
       COUNT(*) FILTER (WHERE "STATUS_CALCULADO" = 'Concluído') AS "CONCLUIDOS",
       AVG("PRAZO_REALIZADO_DIAS_UTEIS") FILTER (WHERE "PRAZO_REALIZADO_DIAS_UTEIS" IS NOT NULL) AS "MEDIA_DIAS_UTEIS",
       AVG(CASE WHEN "DENTRO_PRAZO" IS TRUE THEN 1.0 WHEN "DENTRO_PRAZO" IS FALSE THEN 0.0 END) * 100 AS "PERCENTUAL_NO_PRAZO"
FROM "bi"."comercial_prazos"
GROUP BY DATE_TRUNC('month', "DATA_INICIO")::date, "ROTA";

CREATE OR REPLACE VIEW "bi"."comercial_indicadores_etapas_pbi" AS
WITH etapas AS (
  SELECT p.*, 1 AS ordem_etapa, 'Reabertura da obra'::text AS etapa,
         'Administrativo'::text AS setor, p."launchEmailSentAt" AS etapa_inicio,
         p."workOpenedAt" AS etapa_fim
  FROM "CommercialProcessRecord" p
  WHERE p."active" = TRUE AND p."route" = 'INSERCAO_ADITIVO_SISTEMA'
  UNION ALL
  SELECT p.*, 2, 'Lançamento do aditivo', 'Orçamento', p."workOpenedAt", p."completedDate"
  FROM "CommercialProcessRecord" p
  WHERE p."active" = TRUE AND p."route" = 'INSERCAO_ADITIVO_SISTEMA'
  UNION ALL
  SELECT p.*, 1, 'Lançamento da obra nova', 'Orçamento', p."launchEmailSentAt", p."completedDate"
  FROM "CommercialProcessRecord" p
  WHERE p."active" = TRUE AND p."route" = 'INSERCAO_OBRA_NOVA_SISTEMA'
)
SELECT
  e."id" AS "ID_Registro",
  e."route" AS "Rota",
  CASE e."route"
    WHEN 'INSERCAO_OBRA_NOVA_SISTEMA' THEN 'Inserção de obra nova no sistema'
    WHEN 'INSERCAO_ADITIVO_SISTEMA' THEN 'Inserção de aditivo no sistema'
  END AS "Tema_Indicador",
  e.ordem_etapa AS "Ordem_Etapa",
  e.etapa AS "Etapa",
  e.setor AS "Setor_Responsavel",
  e.etapa_inicio AS "Data_Inicio_Etapa",
  e.etapa_fim AS "Data_Fim_Etapa",
  CASE
    WHEN e.etapa_inicio IS NULL OR e.etapa_fim IS NULL OR e.etapa_fim < e.etapa_inicio THEN NULL
    ELSE (
      SELECT COUNT(*)::integer
      FROM generate_series(e.etapa_inicio + 1, e.etapa_fim, INTERVAL '1 day') AS days(day)
      WHERE EXTRACT(ISODOW FROM days.day) <= 5
    )
  END AS "Tempo_Etapa_Dias_Uteis",
  5 AS "Meta_Total_Dias_Uteis",
  e."launchEmailSentAt" AS "Data_Inicio_Processo",
  e."dueDate" AS "Data_Limite_Processo",
  e."completedDate" AS "Data_Fim_Processo",
  CASE WHEN e."completedDate" IS NULL OR e."dueDate" IS NULL THEN NULL ELSE e."completedDate" <= e."dueDate" END AS "Dentro_Meta_Total",
  CASE
    WHEN e.etapa_inicio IS NULL THEN 'Não iniciada'
    WHEN e.etapa_fim IS NULL THEN 'Em andamento'
    WHEN e.etapa_fim < e.etapa_inicio THEN 'Inconsistente'
    ELSE 'Concluída'
  END AS "Status_Etapa",
  TO_CHAR(e.etapa_inicio, 'YYYY-MM') AS "Mes_Ano_Inicio_Etapa",
  e."competition" AS "Concorrencia",
  e."contractNumber" AS "Contrato",
  e."contractingParty" AS "Contratante",
  e."sourceType" AS "Origem_Dado",
  e."updatedAt" AS "Atualizado_Em"
FROM etapas e;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    GRANT USAGE ON SCHEMA "bi" TO powerbi_reader;
    GRANT SELECT ON "bi"."comercial_oportunidades", "bi"."comercial_prazos", "bi"."comercial_indicadores_mensais", "bi"."comercial_oportunidades_pbi", "bi"."comercial_indicadores_tempos_pbi", "bi"."comercial_indicadores_config_pbi", "bi"."comercial_indicadores_etapas_pbi" TO powerbi_reader;
  END IF;
END $$;
