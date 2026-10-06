CREATE SCHEMA IF NOT EXISTS "bi";

DROP VIEW IF EXISTS "bi"."prumare_indicadores_empreendimento";
DROP VIEW IF EXISTS "bi"."prumare_resumo_mensal_recebiveis";
DROP VIEW IF EXISTS "bi"."prumare_resumo_mensal_vendas";
DROP VIEW IF EXISTS "bi"."prumare_recebiveis";
DROP VIEW IF EXISTS "bi"."prumare_vendas";
DROP VIEW IF EXISTS "bi"."prumare_lotes";
DROP VIEW IF EXISTS "bi"."prumare_empreendimentos";

CREATE VIEW "bi"."prumare_empreendimentos" AS
SELECT
  e."id" AS "empreendimento_id",
  e."name" AS "empreendimento",
  e."tableName" AS "tabela",
  e."registry" AS "registro",
  e."location" AS "localizacao",
  e."city" AS "cidade",
  e."mapUrl" AS "mapa_url",
  e."status" AS "etapa_obra",
  e."deliveryForecast" AS "previsao_entrega",
  e."vgvTarget" AS "vgv_meta",
  e."photoUrl" AS "foto_url",
  CASE
    WHEN NULLIF(TRIM(COALESCE(e."photoUrl", '')), '') IS NULL THEN NULL
    WHEN e."photoUrl" ILIKE 'http%' THEN e."photoUrl"
    ELSE CONCAT('https://api.jrconstrucoes.net.br', e."photoUrl")
  END AS "foto_url_absoluta",
  e."notes" AS "observacoes_comerciais",
  e."createdAt" AS "criado_em",
  e."updatedAt" AS "atualizado_em"
FROM "PrumareEnterprise" e;

CREATE VIEW "bi"."prumare_lotes" AS
SELECT
  l."id" AS "lote_id",
  l."enterpriseId" AS "empreendimento_id",
  e."name" AS "empreendimento",
  l."block" AS "quadra",
  l."lot" AS "lote",
  CONCAT(l."block", ' - ', l."lot") AS "quadra_lote",
  l."areaM2" AS "area_m2",
  l."price" AS "valor_tabela",
  l."status" AS "situacao",
  CASE WHEN l."status" IN ('Vendido', 'Bloqueado') THEN true ELSE false END AS "indisponivel_comercialmente",
  CASE WHEN l."status" = 'Vendido' THEN true ELSE false END AS "vendido",
  CASE WHEN l."status" = 'Disponivel' THEN true ELSE false END AS "disponivel",
  CASE WHEN l."status" = 'Bloqueado' THEN true ELSE false END AS "bloqueado",
  l."mapX" AS "mapa_x",
  l."mapY" AS "mapa_y",
  l."createdAt" AS "criado_em",
  l."updatedAt" AS "atualizado_em"
FROM "PrumareLot" l
INNER JOIN "PrumareEnterprise" e ON e."id" = l."enterpriseId";

CREATE VIEW "bi"."prumare_vendas" AS
SELECT
  l."id" AS "lote_id",
  l."enterpriseId" AS "empreendimento_id",
  e."name" AS "empreendimento",
  l."block" AS "quadra",
  l."lot" AS "lote",
  CONCAT(l."block", ' - ', l."lot") AS "quadra_lote",
  l."areaM2" AS "area_m2",
  l."price" AS "valor_tabela_atual",
  l."status" AS "situacao",
  l."buyerName" AS "cliente",
  l."soldAt" AS "data_venda",
  DATE_TRUNC('month', l."soldAt")::date AS "mes_venda",
  TO_CHAR(l."soldAt", 'YYYY-MM') AS "ano_mes_venda",
  EXTRACT(YEAR FROM l."soldAt")::integer AS "ano_venda",
  EXTRACT(MONTH FROM l."soldAt")::integer AS "mes_numero_venda",
  l."salePrice" AS "valor_venda",
  l."saleContractNumber" AS "contrato",
  l."saleDownPayment" AS "entrada_principal",
  l."saleInstallments" AS "numero_parcelas",
  l."saleFirstInstallmentDate" AS "data_primeira_parcela",
  l."saleDueDay" AS "dia_vencimento",
  l."saleCustomInstallments" AS "parcelas_personalizadas_json",
  CASE
    WHEN jsonb_typeof(l."saleCustomInstallments"::jsonb) = 'array'
    THEN jsonb_array_length(l."saleCustomInstallments"::jsonb)
    ELSE 0
  END AS "qtd_parcelas_personalizadas",
  l."saleAnnualReinforcement" AS "valor_reforco",
  l."saleFirstReinforcementInstallment" AS "primeira_parcela_reforco",
  l."saleReinforcementMonths" AS "meses_reforco",
  l."saleMonthlyRatePercent" AS "juros_am_percentual",
  l."saleBrokerCommission" AS "comissao_corretor",
  l."saleBarters" AS "permutas_json",
  l."paymentCondition" AS "condicao_pagamento",
  l."saleNotes" AS "observacoes_venda",
  b."id" AS "corretor_id",
  b."name" AS "corretor",
  b."phone" AS "corretor_telefone",
  b."email" AS "corretor_email",
  l."createdAt" AS "criado_em",
  l."updatedAt" AS "atualizado_em"
FROM "PrumareLot" l
INNER JOIN "PrumareEnterprise" e ON e."id" = l."enterpriseId"
LEFT JOIN "PrumareBroker" b ON b."id" = l."brokerId"
WHERE l."status" = 'Vendido';

CREATE VIEW "bi"."prumare_recebiveis" AS
SELECT
  r."id" AS "recebivel_id",
  r."enterpriseId" AS "empreendimento_id",
  e."name" AS "empreendimento",
  r."lotId" AS "lote_id",
  l."block" AS "quadra",
  l."lot" AS "lote",
  CONCAT(l."block", ' - ', l."lot") AS "quadra_lote",
  l."buyerName" AS "cliente",
  b."name" AS "corretor",
  r."type"::text AS "tipo",
  CASE r."type"::text
    WHEN 'ENTRADA' THEN 'Entrada'
    WHEN 'PARCELA' THEN 'Parcela'
    WHEN 'REFORCO' THEN 'Reforco'
    WHEN 'COMISSAO' THEN 'Comissao'
    WHEN 'PERMUTA' THEN 'Permuta'
    ELSE r."type"::text
  END AS "tipo_nome",
  r."installmentNo" AS "numero_parcela",
  r."dueDate" AS "data_vencimento",
  DATE_TRUNC('month', r."dueDate")::date AS "mes_vencimento",
  TO_CHAR(r."dueDate", 'YYYY-MM') AS "ano_mes_vencimento",
  EXTRACT(YEAR FROM r."dueDate")::integer AS "ano_vencimento",
  EXTRACT(MONTH FROM r."dueDate")::integer AS "mes_numero_vencimento",
  r."baseValue" AS "valor_base",
  r."correctedValue" AS "valor_corrigido",
  r."appliedIpcaRate" AS "ipca_aplicado_percentual",
  r."ipcaSnapshot" AS "ipca_snapshot_json",
  CASE WHEN r."correctedValue" >= 0 THEN r."correctedValue" ELSE 0 END AS "entrada_caixa",
  CASE WHEN r."correctedValue" < 0 THEN ABS(r."correctedValue") ELSE 0 END AS "saida_caixa",
  r."correctedValue" AS "saldo_caixa",
  l."soldAt" AS "data_venda",
  l."salePrice" AS "valor_venda",
  l."status" AS "situacao_lote",
  r."createdAt" AS "criado_em",
  r."updatedAt" AS "atualizado_em"
FROM "PrumareReceivable" r
INNER JOIN "PrumareEnterprise" e ON e."id" = r."enterpriseId"
INNER JOIN "PrumareLot" l ON l."id" = r."lotId"
LEFT JOIN "PrumareBroker" b ON b."id" = l."brokerId";

CREATE VIEW "bi"."prumare_resumo_mensal_vendas" AS
SELECT
  l."enterpriseId" AS "empreendimento_id",
  e."name" AS "empreendimento",
  DATE_TRUNC('month', l."soldAt")::date AS "mes",
  TO_CHAR(l."soldAt", 'YYYY-MM') AS "ano_mes",
  EXTRACT(YEAR FROM l."soldAt")::integer AS "ano",
  EXTRACT(MONTH FROM l."soldAt")::integer AS "mes_numero",
  COUNT(*)::integer AS "terrenos_vendidos",
  SUM(l."areaM2") AS "area_vendida_m2",
  SUM(l."salePrice") AS "valor_vendido",
  AVG(l."salePrice") AS "ticket_medio",
  AVG(NULLIF(l."salePrice", 0) / NULLIF(l."areaM2", 0)) AS "valor_medio_m2",
  COUNT(DISTINCT l."brokerId")::integer AS "corretores_com_venda",
  COUNT(DISTINCT l."buyerName")::integer AS "clientes_distintos"
FROM "PrumareLot" l
INNER JOIN "PrumareEnterprise" e ON e."id" = l."enterpriseId"
WHERE l."status" = 'Vendido'
  AND l."soldAt" IS NOT NULL
GROUP BY
  l."enterpriseId",
  e."name",
  DATE_TRUNC('month', l."soldAt")::date,
  TO_CHAR(l."soldAt", 'YYYY-MM'),
  EXTRACT(YEAR FROM l."soldAt"),
  EXTRACT(MONTH FROM l."soldAt");

CREATE VIEW "bi"."prumare_resumo_mensal_recebiveis" AS
SELECT
  r."enterpriseId" AS "empreendimento_id",
  e."name" AS "empreendimento",
  DATE_TRUNC('month', r."dueDate")::date AS "mes",
  TO_CHAR(r."dueDate", 'YYYY-MM') AS "ano_mes",
  EXTRACT(YEAR FROM r."dueDate")::integer AS "ano",
  EXTRACT(MONTH FROM r."dueDate")::integer AS "mes_numero",
  COUNT(*)::integer AS "lancamentos",
  COUNT(DISTINCT r."lotId")::integer AS "lotes_com_recebivel",
  SUM(CASE WHEN r."type"::text = 'ENTRADA' THEN r."correctedValue" ELSE 0 END) AS "entradas",
  SUM(CASE WHEN r."type"::text = 'PARCELA' THEN r."correctedValue" ELSE 0 END) AS "parcelas",
  SUM(CASE WHEN r."type"::text = 'REFORCO' THEN r."correctedValue" ELSE 0 END) AS "reforcos",
  SUM(CASE WHEN r."type"::text = 'PERMUTA' THEN r."correctedValue" ELSE 0 END) AS "permutas",
  SUM(CASE WHEN r."type"::text = 'COMISSAO' THEN ABS(r."correctedValue") ELSE 0 END) AS "comissoes",
  SUM(CASE WHEN r."correctedValue" >= 0 THEN r."correctedValue" ELSE 0 END) AS "entrada_caixa",
  SUM(CASE WHEN r."correctedValue" < 0 THEN ABS(r."correctedValue") ELSE 0 END) AS "saida_caixa",
  SUM(r."correctedValue") AS "saldo_caixa",
  SUM(r."correctedValue" - r."baseValue") AS "correcao_ipca"
FROM "PrumareReceivable" r
INNER JOIN "PrumareEnterprise" e ON e."id" = r."enterpriseId"
GROUP BY
  r."enterpriseId",
  e."name",
  DATE_TRUNC('month', r."dueDate")::date,
  TO_CHAR(r."dueDate", 'YYYY-MM'),
  EXTRACT(YEAR FROM r."dueDate"),
  EXTRACT(MONTH FROM r."dueDate");

CREATE VIEW "bi"."prumare_indicadores_empreendimento" AS
WITH lotes AS (
  SELECT
    l."enterpriseId",
    COUNT(*)::integer AS total_lotes,
    COUNT(*) FILTER (WHERE l."status" = 'Vendido')::integer AS lotes_vendidos,
    COUNT(*) FILTER (WHERE l."status" = 'Disponivel')::integer AS lotes_disponiveis,
    COUNT(*) FILTER (WHERE l."status" = 'Bloqueado')::integer AS lotes_bloqueados,
    SUM(l."price") AS vgv_tabela_atual,
    SUM(CASE WHEN l."status" = 'Vendido' THEN COALESCE(l."salePrice", l."price") ELSE 0 END) AS valor_vendido,
    SUM(CASE WHEN l."status" <> 'Vendido' THEN l."price" ELSE 0 END) AS estoque_aberto
  FROM "PrumareLot" l
  GROUP BY l."enterpriseId"
),
recebiveis AS (
  SELECT
    r."enterpriseId",
    SUM(CASE WHEN r."correctedValue" >= 0 THEN r."correctedValue" ELSE 0 END) AS recebimento_bruto_corrigido,
    SUM(CASE WHEN r."type"::text = 'COMISSAO' THEN ABS(r."correctedValue") ELSE 0 END) AS comissoes_previstas,
    SUM(r."correctedValue") AS recebimento_liquido,
    SUM(r."correctedValue" - r."baseValue") AS juros_ipca_previstos
  FROM "PrumareReceivable" r
  GROUP BY r."enterpriseId"
)
SELECT
  e."id" AS "empreendimento_id",
  e."name" AS "empreendimento",
  e."status" AS "etapa_obra",
  e."deliveryForecast" AS "previsao_entrega",
  e."vgvTarget" AS "vgv_meta",
  COALESCE(l.total_lotes, 0) AS "total_lotes",
  COALESCE(l.lotes_vendidos, 0) AS "lotes_vendidos",
  COALESCE(l.lotes_disponiveis, 0) AS "lotes_disponiveis",
  COALESCE(l.lotes_bloqueados, 0) AS "lotes_bloqueados",
  ROUND((COALESCE(l.lotes_vendidos, 0)::numeric / NULLIF(l.total_lotes, 0)) * 100, 2) AS "percentual_lotes_vendidos",
  l.vgv_tabela_atual AS "vgv_tabela_atual",
  l.valor_vendido AS "valor_vendido",
  l.estoque_aberto AS "estoque_aberto",
  COALESCE(l.valor_vendido, 0) + COALESCE(l.estoque_aberto, 0) AS "vgv_projetado",
  (COALESCE(l.valor_vendido, 0) + COALESCE(l.estoque_aberto, 0)) - COALESCE(e."vgvTarget", 0) AS "diferenca_meta_vgv",
  ROUND(((COALESCE(l.valor_vendido, 0) + COALESCE(l.estoque_aberto, 0)) / NULLIF(e."vgvTarget", 0)) * 100, 2) AS "percentual_meta_vgv",
  r.recebimento_bruto_corrigido,
  r.comissoes_previstas,
  r.recebimento_liquido,
  r.juros_ipca_previstos
FROM "PrumareEnterprise" e
LEFT JOIN lotes l ON l."enterpriseId" = e."id"
LEFT JOIN recebiveis r ON r."enterpriseId" = e."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO powerbi_reader';
  END IF;
END $$;
