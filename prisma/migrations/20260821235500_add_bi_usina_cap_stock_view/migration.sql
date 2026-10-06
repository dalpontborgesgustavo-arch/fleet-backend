CREATE SCHEMA IF NOT EXISTS "bi";

CREATE OR REPLACE VIEW "bi"."usina_cap_estoque_historico" AS
WITH regular_history AS (
  SELECT
    h."id" AS evento_id,
    h."inventoryId" AS inventario_id,
    i."company" AS empresa_codigo,
    CASE i."company"
      WHEN 'USINA_JR' THEN 'Usina JR'
      WHEN 'PEDRAFORTE' THEN 'Pedraforte'
      ELSE i."company"
    END AS empresa_nome,
    make_date(i."referenceYear", i."referenceMonth", 1) AS competencia,
    COALESCE(
      NULLIF(h."snapshot" #>> '{after,measuredAt}', '')::timestamptz,
      i."measuredAt"
    ) AS data_contagem,
    h."createdAt" AS dt_evento,
    h."action" AS acao_evento,
    h."actorId" AS usuario_id,
    u."name" AS usuario_lancamento,
    item ->> 'materialId' AS item_id,
    NULLIF(item ->> 'volumeM3', '')::numeric AS quantidade_original,
    NULLIF(item ->> 'densitySnapshot', '')::numeric AS densidade_aplicada,
    NULLIF(item ->> 'tonnage', '')::numeric AS quantidade_t,
    i."source" AS fonte_inventario
  FROM "TopographyInventoryHistory" h
  JOIN "TopographyInventory" i ON i."id" = h."inventoryId"
  LEFT JOIN "User" u ON u."id" = h."actorId"
  CROSS JOIN LATERAL jsonb_array_elements(h."snapshot" #> '{after,items}') item
  WHERE jsonb_typeof(h."snapshot" #> '{after,items}') = 'array'
),
legacy_cap_history AS (
  SELECT
    h."id" AS evento_id,
    h."inventoryId" AS inventario_id,
    i."company" AS empresa_codigo,
    CASE i."company"
      WHEN 'USINA_JR' THEN 'Usina JR'
      WHEN 'PEDRAFORTE' THEN 'Pedraforte'
      ELSE i."company"
    END AS empresa_nome,
    make_date(
      COALESCE(NULLIF(h."snapshot" ->> 'referenceYear', '')::integer, i."referenceYear"),
      COALESCE(NULLIF(h."snapshot" ->> 'referenceMonth', '')::integer, i."referenceMonth"),
      1
    ) AS competencia,
    COALESCE(
      NULLIF(h."snapshot" ->> 'measuredAt', '')::timestamptz,
      i."measuredAt"
    ) AS data_contagem,
    h."createdAt" AS dt_evento,
    h."action" AS acao_evento,
    h."actorId" AS usuario_id,
    u."name" AS usuario_lancamento,
    m."id" AS item_id,
    NULLIF(item ->> 'tonnage', '')::numeric AS quantidade_original,
    NULL::numeric AS densidade_aplicada,
    NULLIF(item ->> 'tonnage', '')::numeric AS quantidade_t,
    i."source" AS fonte_inventario
  FROM "TopographyInventoryHistory" h
  JOIN "TopographyInventory" i ON i."id" = h."inventoryId"
  LEFT JOIN "User" u ON u."id" = h."actorId"
  CROSS JOIN LATERAL jsonb_array_elements(h."snapshot" -> 'items') item
  LEFT JOIN "TopographyInventoryMaterial" m
    ON m."company" = i."company"
   AND (
     m."aethosItemCode" = item ->> 'code'
     OR (m."aethosItemCode" IS NULL AND m."name" = item ->> 'material')
   )
  WHERE h."action" = 'IMPORTED_LEGACY_CAP'
    AND jsonb_typeof(h."snapshot" -> 'items') = 'array'
),
history_rows AS (
  SELECT * FROM regular_history
  UNION ALL
  SELECT * FROM legacy_cap_history
),
current_fallback AS (
  SELECT
    ('CURRENT:' || ii."id")::text AS evento_id,
    i."id" AS inventario_id,
    i."company" AS empresa_codigo,
    CASE i."company"
      WHEN 'USINA_JR' THEN 'Usina JR'
      WHEN 'PEDRAFORTE' THEN 'Pedraforte'
      ELSE i."company"
    END AS empresa_nome,
    make_date(i."referenceYear", i."referenceMonth", 1) AS competencia,
    i."measuredAt" AS data_contagem,
    ii."updatedAt" AS dt_evento,
    'CURRENT_STATE_FALLBACK'::text AS acao_evento,
    i."updatedById" AS usuario_id,
    u."name" AS usuario_lancamento,
    ii."materialId" AS item_id,
    ii."volumeM3"::numeric AS quantidade_original,
    ii."densitySnapshot"::numeric AS densidade_aplicada,
    ii."tonnage"::numeric AS quantidade_t,
    i."source" AS fonte_inventario
  FROM "TopographyInventory" i
  JOIN "TopographyInventoryItem" ii ON ii."inventoryId" = i."id"
  JOIN "TopographyInventoryMaterial" m ON m."id" = ii."materialId"
  LEFT JOIN "User" u ON u."id" = i."updatedById"
  WHERE (
    m."aethosItemCode" IN ('1813', '5643', '13861')
    OR upper(m."name") LIKE 'CAP %'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM history_rows hr
      WHERE hr.inventario_id = i."id"
        AND hr.item_id = ii."materialId"
    )
),
all_rows AS (
  SELECT * FROM history_rows
  UNION ALL
  SELECT * FROM current_fallback
),
cap_rows AS (
  SELECT
    r.*,
    m."name" AS item_descricao,
    m."aethosItemCode" AS item_codigo,
    m."inputUnit" AS unidade_original,
    CASE
      WHEN m."aethosItemCode" = '1813' OR upper(m."name") LIKE '%50/70%' THEN 'CAP 50/70'
      WHEN upper(m."name") LIKE '%BORRACHA%' THEN 'CAP Borracha'
      WHEN m."aethosItemCode" = '5643' OR upper(m."name") LIKE '%POL%MERO%' THEN 'CAP Polímero'
      WHEN m."aethosItemCode" = '13861' OR upper(m."name") LIKE '%ALTO M%DULO%' THEN 'CAP Alto Módulo'
      ELSE m."name"
    END AS tipo_cap_normalizado
  FROM all_rows r
  JOIN "TopographyInventoryMaterial" m ON m."id" = r.item_id
  WHERE (
    m."aethosItemCode" IN ('1813', '5643', '13861')
    OR upper(m."name") LIKE 'CAP %'
  )
),
ranked AS (
  SELECT
    c.*,
    row_number() OVER (
      PARTITION BY c.empresa_codigo, c.competencia, c.item_id
      ORDER BY c.dt_evento DESC, c.evento_id DESC
    ) AS ordem_fechamento
  FROM cap_rows c
)
SELECT
  evento_id AS revisao_id,
  inventario_id,
  competencia,
  data_contagem,
  empresa_codigo,
  empresa_nome,
  NULL::text AS filial_codigo,
  NULL::text AS filial_nome,
  empresa_codigo AS local_estoque_id,
  empresa_nome AS local_estoque_nome,
  item_id,
  item_codigo,
  item_descricao,
  tipo_cap_normalizado,
  quantidade_original,
  unidade_original,
  densidade_aplicada,
  quantidade_t,
  (ordem_fechamento = 1) AS indicador_fechamento_mes,
  CASE
    WHEN ordem_fechamento = 1 THEN 'VALIDO_FECHAMENTO'
    ELSE 'HISTORICO_SUPERADO'
  END AS status_registro,
  usuario_id,
  usuario_lancamento,
  dt_evento AS dt_lancamento,
  dt_evento AS dt_alteracao,
  acao_evento,
  fonte_inventario AS fonte_registro
FROM ranked;

COMMENT ON VIEW "bi"."usina_cap_estoque_historico" IS
  'Histórico auditável das contagens de CAP do Inventário da Topografia. Uma linha por item e revisão; indicador_fechamento_mes marca a revisão vigente de cada competência.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    GRANT USAGE ON SCHEMA "bi" TO powerbi_reader;
    GRANT SELECT ON "bi"."usina_cap_estoque_historico" TO powerbi_reader;
  END IF;
END $$;
