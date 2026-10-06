CREATE SCHEMA IF NOT EXISTS "bi";

DROP VIEW IF EXISTS "bi"."obras_cronograma_financeiro";
DROP VIEW IF EXISTS "bi"."obras_indicadores";
DROP VIEW IF EXISTS "bi"."obras_requisitos";
DROP VIEW IF EXISTS "bi"."obras_arts";
DROP VIEW IF EXISTS "bi"."obras_aditivos";
DROP VIEW IF EXISTS "bi"."obras_medicoes";
DROP VIEW IF EXISTS "bi"."obras_metas_medicao";
DROP VIEW IF EXISTS "bi"."obras_etapas";
DROP VIEW IF EXISTS "bi"."obras_engenheiros";
DROP VIEW IF EXISTS "bi"."obras";

CREATE VIEW "bi"."obras" AS
WITH state AS (
  SELECT "data"::jsonb AS data
  FROM "ConstructionControlState"
  WHERE "id" = 'default'
)
SELECT
  w.id AS "obra_id",
  w."codigoObra" AS "codigo_obra",
  w.apelido AS "apelido_obra",
  w.nome AS "nome_obra",
  w.cliente AS "cliente",
  w.edital AS "edital",
  w."tipoObra" AS "tipo_obra",
  w.rua AS "rua",
  w.uf AS "uf",
  w.cidade AS "cidade",
  w.contrato AS "contrato",
  CASE WHEN w."valorInicialContrato" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN w."valorInicialContrato"::numeric ELSE 0 END AS "valor_inicial_contrato",
  CASE WHEN w."dataAssinatura" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN w."dataAssinatura"::date ELSE NULL END AS "data_assinatura",
  CASE WHEN w."dataEntrega" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN w."dataEntrega"::date ELSE NULL END AS "data_entrega",
  CASE WHEN w."dataEntregaFixa" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN w."dataEntregaFixa"::date ELSE NULL END AS "data_entrega_fixa",
  CASE WHEN w."dataVigencia" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN w."dataVigencia"::date ELSE NULL END AS "data_vigencia",
  CASE WHEN w."dataOs" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN w."dataOs"::date ELSE NULL END AS "data_os",
  CASE WHEN w."dataVistoriaInicial" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN w."dataVistoriaInicial"::date ELSE NULL END AS "data_vistoria_inicial",
  CASE WHEN w."prazoEntregaDias" ~ '^-?[0-9]+$' THEN w."prazoEntregaDias"::integer ELSE NULL END AS "prazo_entrega_dias",
  w.gerente AS "gerente",
  w.engenheiro AS "engenheiro",
  w."participantesVistoriaInicial" AS "participantes_vistoria_inicial",
  w.os AS "os",
  CASE WHEN w."bdiPrevisto" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN w."bdiPrevisto"::numeric ELSE NULL END AS "bdi_previsto",
  w.cno AS "cno",
  w.observacao AS "observacao",
  w.usuario AS "usuario",
  w."statusObra" AS "status_obra",
  w."termoDefinitivoFinalizado" AS "termo_definitivo_finalizado"
FROM state
CROSS JOIN jsonb_to_recordset(COALESCE(state.data->'works', '[]'::jsonb)) AS w(
  id text,
  cliente text,
  apelido text,
  nome text,
  edital text,
  "tipoObra" text,
  rua text,
  uf text,
  cidade text,
  contrato text,
  "valorInicialContrato" text,
  "dataEntrega" text,
  gerente text,
  engenheiro text,
  "dataVistoriaInicial" text,
  "participantesVistoriaInicial" text,
  os text,
  "dataOs" text,
  "dataAssinatura" text,
  "codigoObra" text,
  "bdiPrevisto" text,
  cno text,
  observacao text,
  "prazoEntregaDias" text,
  "dataEntregaFixa" text,
  "dataVigencia" text,
  usuario text,
  "statusObra" text,
  "termoDefinitivoFinalizado" text
);

CREATE VIEW "bi"."obras_engenheiros" AS
WITH state AS (
  SELECT "data"::jsonb AS data
  FROM "ConstructionControlState"
  WHERE "id" = 'default'
)
SELECT
  e.id AS "engenheiro_id",
  e.nome AS "engenheiro",
  e.status AS "status"
FROM state
CROSS JOIN jsonb_to_recordset(COALESCE(state.data->'engineers', '[]'::jsonb)) AS e(
  id text,
  nome text,
  status text
);

CREATE VIEW "bi"."obras_etapas" AS
WITH state AS (
  SELECT "data"::jsonb AS data
  FROM "ConstructionControlState"
  WHERE "id" = 'default'
)
SELECT
  s.id AS "etapa_id",
  s."workId" AS "obra_id",
  o."codigo_obra",
  o."apelido_obra",
  o."nome_obra",
  s.descricao AS "etapa",
  s.possui AS "possui",
  CASE WHEN s."dataInicio" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN s."dataInicio"::date ELSE NULL END AS "data_inicio",
  CASE WHEN s."dataFim" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN s."dataFim"::date ELSE NULL END AS "data_fim",
  CASE
    WHEN s."dataInicio" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND s."dataFim" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND CURRENT_DATE >= s."dataFim"::date THEN 100
    WHEN s."dataInicio" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND s."dataFim" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND CURRENT_DATE <= s."dataInicio"::date THEN 0
    WHEN s."dataInicio" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND s."dataFim" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND s."dataFim"::date > s."dataInicio"::date
      THEN ROUND(((CURRENT_DATE - s."dataInicio"::date)::numeric / NULLIF((s."dataFim"::date - s."dataInicio"::date), 0)) * 100, 2)
    ELSE NULL
  END AS "percentual_prazo_calculado"
FROM state
CROSS JOIN jsonb_to_recordset(COALESCE(state.data->'stages', '[]'::jsonb)) AS s(
  id text,
  "workId" text,
  descricao text,
  possui text,
  "dataInicio" text,
  "dataFim" text,
  "metasMedicao" jsonb
)
LEFT JOIN "bi"."obras" o ON o."obra_id" = s."workId";

CREATE VIEW "bi"."obras_metas_medicao" AS
WITH state AS (
  SELECT "data"::jsonb AS data
  FROM "ConstructionControlState"
  WHERE "id" = 'default'
),
stages AS (
  SELECT s.*
  FROM state
  CROSS JOIN jsonb_to_recordset(COALESCE(state.data->'stages', '[]'::jsonb)) AS s(
    id text,
    "workId" text,
    descricao text,
    possui text,
    "dataInicio" text,
    "dataFim" text,
    "metasMedicao" jsonb
  )
)
SELECT
  g.id AS "meta_id",
  s.id AS "etapa_id",
  s."workId" AS "obra_id",
  o."codigo_obra",
  o."apelido_obra",
  o."nome_obra",
  s.descricao AS "etapa",
  CASE WHEN g."dataInicio" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN g."dataInicio"::date ELSE NULL END AS "data_inicio_meta",
  CASE WHEN g."dataFim" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN g."dataFim"::date ELSE NULL END AS "data_fim_meta",
  CASE WHEN g."dataMeta" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN g."dataMeta"::date ELSE NULL END AS "data_meta",
  COALESCE(
    CASE WHEN g."dataFim" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN g."dataFim"::date ELSE NULL END,
    CASE WHEN g."dataMeta" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN g."dataMeta"::date ELSE NULL END,
    CASE WHEN g."dataInicio" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN g."dataInicio"::date ELSE NULL END
  ) AS "data_referencia_meta",
  DATE_TRUNC('month', COALESCE(
    CASE WHEN g."dataFim" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN g."dataFim"::date ELSE NULL END,
    CASE WHEN g."dataMeta" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN g."dataMeta"::date ELSE NULL END,
    CASE WHEN g."dataInicio" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN g."dataInicio"::date ELSE NULL END
  ))::date AS "mes_referencia",
  CASE WHEN g."valorMeta" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN g."valorMeta"::numeric ELSE 0 END AS "valor_meta"
FROM stages s
CROSS JOIN jsonb_to_recordset(COALESCE(s."metasMedicao", '[]'::jsonb)) AS g(
  id text,
  "dataInicio" text,
  "dataFim" text,
  "dataMeta" text,
  "valorMeta" text
)
LEFT JOIN "bi"."obras" o ON o."obra_id" = s."workId";

CREATE VIEW "bi"."obras_medicoes" AS
WITH state AS (
  SELECT "data"::jsonb AS data
  FROM "ConstructionControlState"
  WHERE "id" = 'default'
)
SELECT
  m.id AS "medicao_id",
  m."workId" AS "obra_id",
  o."codigo_obra",
  o."apelido_obra",
  o."nome_obra",
  m.descricao AS "etapa",
  CASE WHEN m."valorContratadoTotal" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN m."valorContratadoTotal"::numeric ELSE 0 END AS "valor_contratado_total",
  CASE WHEN m."executadoMes" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN m."executadoMes"::numeric ELSE 0 END AS "executado_mes",
  CASE WHEN m."valorRealizadoAditivo" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN m."valorRealizadoAditivo"::numeric ELSE 0 END AS "valor_realizado_aditivo",
  CASE WHEN m."executadoMes" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN m."executadoMes"::numeric ELSE 0 END
    + CASE WHEN m."valorRealizadoAditivo" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN m."valorRealizadoAditivo"::numeric ELSE 0 END AS "realizado_total_mes",
  m."mesReferencia" AS "mes_referencia_nome",
  CASE WHEN m."anoReferencia" ~ '^-?[0-9]+$' THEN m."anoReferencia"::integer ELSE NULL END AS "ano_referencia",
  CASE
    WHEN m."dataAte" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN DATE_TRUNC('month', m."dataAte"::date)::date
    WHEN m."dataDe" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN DATE_TRUNC('month', m."dataDe"::date)::date
    WHEN m."anoReferencia" ~ '^-?[0-9]+$' THEN make_date(m."anoReferencia"::integer, CASE LOWER(m."mesReferencia")
      WHEN 'janeiro' THEN 1
      WHEN 'fevereiro' THEN 2
      WHEN 'marco' THEN 3
      WHEN 'março' THEN 3
      WHEN 'abril' THEN 4
      WHEN 'maio' THEN 5
      WHEN 'junho' THEN 6
      WHEN 'julho' THEN 7
      WHEN 'agosto' THEN 8
      WHEN 'setembro' THEN 9
      WHEN 'outubro' THEN 10
      WHEN 'novembro' THEN 11
      WHEN 'dezembro' THEN 12
      ELSE 1
    END, 1)
    ELSE NULL
  END AS "mes_referencia",
  CASE WHEN m."dataDe" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN m."dataDe"::date ELSE NULL END AS "data_medicao_de",
  CASE WHEN m."dataAte" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN m."dataAte"::date ELSE NULL END AS "data_medicao_ate"
FROM state
CROSS JOIN jsonb_to_recordset(COALESCE(state.data->'measurements', '[]'::jsonb)) AS m(
  id text,
  "workId" text,
  descricao text,
  "valorContratadoTotal" text,
  "executadoMes" text,
  "valorRealizadoAditivo" text,
  "mesReferencia" text,
  "anoReferencia" text,
  "dataDe" text,
  "dataAte" text
)
LEFT JOIN "bi"."obras" o ON o."obra_id" = m."workId";

CREATE VIEW "bi"."obras_aditivos" AS
WITH state AS (
  SELECT "data"::jsonb AS data
  FROM "ConstructionControlState"
  WHERE "id" = 'default'
)
SELECT
  a.id AS "aditivo_id",
  a."workId" AS "obra_id",
  o."codigo_obra",
  o."apelido_obra",
  o."nome_obra",
  a.tipo AS "tipo",
  a.subtipo AS "subtipo",
  a.etapa AS "etapa",
  CASE WHEN a.valor ~ '^-?[0-9]+(\.[0-9]+)?$' THEN a.valor::numeric ELSE 0 END AS "valor",
  CASE WHEN a."dataLancamento" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN a."dataLancamento"::date ELSE NULL END AS "data_lancamento",
  CASE WHEN a."dataAditivoPrazo" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN a."dataAditivoPrazo"::date ELSE NULL END AS "nova_data_prazo",
  CASE WHEN a."dataDocumento" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN a."dataDocumento"::date ELSE NULL END AS "data_documento",
  a."numeroAditivo" AS "numero_aditivo",
  a.prateleira AS "prateleira",
  a."calculoPrazo" AS "calculo_prazo",
  CASE WHEN a."prazoDias" ~ '^-?[0-9]+$' THEN a."prazoDias"::integer ELSE NULL END AS "prazo_dias"
FROM state
CROSS JOIN jsonb_to_recordset(COALESCE(state.data->'additives', '[]'::jsonb)) AS a(
  id text,
  "workId" text,
  tipo text,
  subtipo text,
  valor text,
  "dataLancamento" text,
  "dataAditivoPrazo" text,
  "dataDocumento" text,
  etapa text,
  "numeroAditivo" text,
  prateleira text,
  "calculoPrazo" text,
  "prazoDias" text
)
LEFT JOIN "bi"."obras" o ON o."obra_id" = a."workId";

CREATE VIEW "bi"."obras_arts" AS
WITH state AS (
  SELECT "data"::jsonb AS data
  FROM "ConstructionControlState"
  WHERE "id" = 'default'
)
SELECT
  art.id AS "art_id",
  art."workId" AS "obra_id",
  o."codigo_obra",
  o."apelido_obra",
  o."nome_obra",
  art.numero AS "numero_art",
  art.engenheiro AS "engenheiro"
FROM state
CROSS JOIN jsonb_to_recordset(COALESCE(state.data->'arts', '[]'::jsonb)) AS art(
  id text,
  "workId" text,
  numero text,
  engenheiro text
)
LEFT JOIN "bi"."obras" o ON o."obra_id" = art."workId";

CREATE VIEW "bi"."obras_requisitos" AS
WITH state AS (
  SELECT "data"::jsonb AS data
  FROM "ConstructionControlState"
  WHERE "id" = 'default'
),
quality AS (
  SELECT
    q.id AS requisito_id,
    q."workId" AS obra_id,
    'Qualidade'::text AS grupo,
    q.item AS item,
    q.descricao AS descricao,
    q.possui AS possui
  FROM state
  CROSS JOIN jsonb_to_recordset(COALESCE(state.data->'quality', '[]'::jsonb)) AS q(
    id text,
    "workId" text,
    item text,
    descricao text,
    possui text
  )
),
req_groups AS (
  SELECT r."workId" AS obra_id, r.seguranca, r.ambiental
  FROM state
  CROSS JOIN jsonb_to_recordset(COALESCE(state.data->'requirements', '[]'::jsonb)) AS r(
    "workId" text,
    seguranca jsonb,
    ambiental jsonb
  )
),
security AS (
  SELECT
    CONCAT(r.obra_id, '-seg-', e.key) AS requisito_id,
    r.obra_id,
    'Seguranca'::text AS grupo,
    e.key AS item,
    e.key AS descricao,
    e.value AS possui
  FROM req_groups r
  CROSS JOIN LATERAL jsonb_each_text(COALESCE(r.seguranca, '{}'::jsonb)) e
),
environmental AS (
  SELECT
    CONCAT(r.obra_id, '-amb-', e.key) AS requisito_id,
    r.obra_id,
    'Ambiental'::text AS grupo,
    e.key AS item,
    e.key AS descricao,
    e.value AS possui
  FROM req_groups r
  CROSS JOIN LATERAL jsonb_each_text(COALESCE(r.ambiental, '{}'::jsonb)) e
)
SELECT
  req.requisito_id,
  req.obra_id,
  o."codigo_obra",
  o."apelido_obra",
  o."nome_obra",
  req.grupo,
  req.item,
  req.descricao,
  req.possui,
  CASE WHEN req.possui = 'Sim' THEN true ELSE false END AS "atendido"
FROM (
  SELECT * FROM quality
  UNION ALL
  SELECT * FROM security
  UNION ALL
  SELECT * FROM environmental
) req
LEFT JOIN "bi"."obras" o ON o."obra_id" = req.obra_id;

CREATE VIEW "bi"."obras_indicadores" AS
WITH contrato AS (
  SELECT
    o."obra_id",
    o."valor_inicial_contrato",
    COALESCE(SUM(a."valor") FILTER (WHERE a."tipo" = 'Valor'), 0) AS "valor_aditivo_contrato",
    COALESCE(MAX(a."nova_data_prazo") FILTER (WHERE a."tipo" = 'Prazo'), NULL) AS "ultima_data_aditivada"
  FROM "bi"."obras" o
  LEFT JOIN "bi"."obras_aditivos" a ON a."obra_id" = o."obra_id"
  GROUP BY o."obra_id", o."valor_inicial_contrato"
),
medicoes AS (
  SELECT
    m."obra_id",
    COALESCE(SUM(m."executado_mes"), 0) AS "executado_contrato",
    COALESCE(SUM(m."valor_realizado_aditivo"), 0) AS "executado_aditivo",
    COALESCE(SUM(m."realizado_total_mes"), 0) AS "executado_total"
  FROM "bi"."obras_medicoes" m
  GROUP BY m."obra_id"
),
datas AS (
  SELECT
    e."obra_id",
    MIN(e."data_inicio") AS "data_inicio_obra",
    MAX(e."data_fim") AS "data_fim_obra"
  FROM "bi"."obras_etapas" e
  WHERE e."possui" = 'Sim'
  GROUP BY e."obra_id"
)
SELECT
  o."obra_id",
  o."codigo_obra",
  o."apelido_obra",
  o."nome_obra",
  o."cliente",
  o."cidade",
  o."gerente",
  o."engenheiro",
  o."status_obra",
  d."data_inicio_obra",
  d."data_fim_obra",
  o."data_entrega",
  c."ultima_data_aditivada",
  c."valor_inicial_contrato" AS "contrato_original",
  c."valor_aditivo_contrato" AS "contrato_aditivo",
  c."valor_inicial_contrato" + c."valor_aditivo_contrato" AS "contrato_total",
  COALESCE(m."executado_contrato", 0) AS "executado_contrato",
  COALESCE(m."executado_aditivo", 0) AS "executado_aditivo",
  COALESCE(m."executado_total", 0) AS "executado_total",
  (c."valor_inicial_contrato" - COALESCE(m."executado_contrato", 0)) AS "saldo_contrato",
  (c."valor_aditivo_contrato" - COALESCE(m."executado_aditivo", 0)) AS "saldo_aditivo",
  (c."valor_inicial_contrato" + c."valor_aditivo_contrato" - COALESCE(m."executado_total", 0)) AS "saldo_total",
  ROUND((COALESCE(m."executado_total", 0) / NULLIF(c."valor_inicial_contrato" + c."valor_aditivo_contrato", 0)) * 100, 2) AS "percentual_executado_total"
FROM "bi"."obras" o
LEFT JOIN contrato c ON c."obra_id" = o."obra_id"
LEFT JOIN medicoes m ON m."obra_id" = o."obra_id"
LEFT JOIN datas d ON d."obra_id" = o."obra_id";

CREATE VIEW "bi"."obras_cronograma_financeiro" AS
WITH meses AS (
  SELECT "obra_id", "mes_referencia"
  FROM "bi"."obras_metas_medicao"
  WHERE "mes_referencia" IS NOT NULL
  UNION
  SELECT "obra_id", "mes_referencia"
  FROM "bi"."obras_medicoes"
  WHERE "mes_referencia" IS NOT NULL
),
metas AS (
  SELECT
    "obra_id",
    "mes_referencia",
    SUM("valor_meta") AS "meta_mes"
  FROM "bi"."obras_metas_medicao"
  WHERE "mes_referencia" IS NOT NULL
  GROUP BY "obra_id", "mes_referencia"
),
realizado AS (
  SELECT
    "obra_id",
    "mes_referencia",
    SUM("realizado_total_mes") AS "realizado_mes",
    SUM("executado_mes") AS "executado_contrato_mes",
    SUM("valor_realizado_aditivo") AS "executado_aditivo_mes"
  FROM "bi"."obras_medicoes"
  WHERE "mes_referencia" IS NOT NULL
  GROUP BY "obra_id", "mes_referencia"
),
base AS (
  SELECT
    meses."obra_id",
    meses."mes_referencia",
    COALESCE(metas."meta_mes", 0) AS "meta_mes",
    COALESCE(realizado."realizado_mes", 0) AS "realizado_mes",
    COALESCE(realizado."executado_contrato_mes", 0) AS "executado_contrato_mes",
    COALESCE(realizado."executado_aditivo_mes", 0) AS "executado_aditivo_mes"
  FROM meses
  LEFT JOIN metas ON metas."obra_id" = meses."obra_id" AND metas."mes_referencia" = meses."mes_referencia"
  LEFT JOIN realizado ON realizado."obra_id" = meses."obra_id" AND realizado."mes_referencia" = meses."mes_referencia"
)
SELECT
  base."obra_id",
  o."codigo_obra",
  o."apelido_obra",
  o."nome_obra",
  base."mes_referencia",
  TO_CHAR(base."mes_referencia", 'YYYY-MM') AS "ano_mes",
  EXTRACT(YEAR FROM base."mes_referencia")::integer AS "ano",
  EXTRACT(MONTH FROM base."mes_referencia")::integer AS "mes_numero",
  base."meta_mes",
  base."realizado_mes",
  base."executado_contrato_mes",
  base."executado_aditivo_mes",
  SUM(base."meta_mes") OVER (PARTITION BY base."obra_id" ORDER BY base."mes_referencia") AS "meta_acumulada",
  SUM(base."realizado_mes") OVER (PARTITION BY base."obra_id" ORDER BY base."mes_referencia") AS "realizado_acumulado",
  SUM(base."realizado_mes") OVER (PARTITION BY base."obra_id" ORDER BY base."mes_referencia")
    - SUM(base."meta_mes") OVER (PARTITION BY base."obra_id" ORDER BY base."mes_referencia") AS "diferenca_acumulada",
  ROUND((SUM(base."realizado_mes") OVER (PARTITION BY base."obra_id" ORDER BY base."mes_referencia")
    / NULLIF(SUM(base."meta_mes") OVER (PARTITION BY base."obra_id" ORDER BY base."mes_referencia"), 0)) * 100, 2) AS "percentual_meta_acumulada",
  CASE
    WHEN SUM(base."realizado_mes") OVER (PARTITION BY base."obra_id" ORDER BY base."mes_referencia")
      >= SUM(base."meta_mes") OVER (PARTITION BY base."obra_id" ORDER BY base."mes_referencia")
    THEN 'Dentro da meta'
    ELSE 'Abaixo da meta'
  END AS "status_meta"
FROM base
LEFT JOIN "bi"."obras" o ON o."obra_id" = base."obra_id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA bi TO powerbi_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO powerbi_reader';
  END IF;
END $$;
