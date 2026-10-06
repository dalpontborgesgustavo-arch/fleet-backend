-- Normaliza o engenheiro responsavel das RNCs para que o Power BI nao
-- separe prefixos como "Eng." nem mantenha categorias vazias.
-- Quando um registro antigo nao possui responsavel, tenta recuperar o
-- engenheiro pelo codigo da obra; se isso nao for possivel, deixa a
-- pendencia explicita como "Sem responsavel".

WITH responsaveis_limpos AS (
  SELECT
    r."id",
    r."obra",
    NULLIF(
      BTRIM(
        REGEXP_REPLACE(
          REGEXP_REPLACE(COALESCE(r."responsavel", ''), '\s+', ' ', 'g'),
          '^eng(enheiro|enheira)?\.?\s*',
          '',
          'i'
        )
      ),
      ''
    ) AS nome_limpo
  FROM "Rnc" r
),
responsaveis_inferidos AS (
  SELECT
    r."id",
    COALESCE(
      r.nome_limpo,
      NULLIF(BTRIM(obra.engenheiro), ''),
      'Sem responsavel'
    ) AS nome_candidato
  FROM responsaveis_limpos r
  LEFT JOIN LATERAL (
    SELECT o."engenheiro"
    FROM "bi"."obras" o
    WHERE REGEXP_REPLACE(COALESCE(o."codigo_obra", ''), '^0+', '') =
          REGEXP_REPLACE(COALESCE(r."obra", ''), '^0+', '')
      AND NULLIF(BTRIM(o."engenheiro"), '') IS NOT NULL
    ORDER BY o."obra_id"
    LIMIT 1
  ) obra ON TRUE
),
responsaveis_canonicos AS (
  SELECT
    r."id",
    COALESCE(
      (
        SELECT e."engenheiro"
        FROM "bi"."obras_engenheiros" e
        WHERE LOWER(
          BTRIM(
            REGEXP_REPLACE(
              REGEXP_REPLACE(COALESCE(e."engenheiro", ''), '\s+', ' ', 'g'),
              '^eng(enheiro|enheira)?\.?\s*',
              '',
              'i'
            )
          )
        ) = LOWER(r.nome_candidato)
        ORDER BY (e."status" = 'Ativo') DESC, e."engenheiro_id"
        LIMIT 1
      ),
      r.nome_candidato
    ) AS nome_canonico
  FROM responsaveis_inferidos r
)
UPDATE "Rnc" r
SET "responsavel" = c.nome_canonico,
    "updatedAt" = NOW()
FROM responsaveis_canonicos c
WHERE c."id" = r."id"
  AND r."responsavel" IS DISTINCT FROM c.nome_canonico;
