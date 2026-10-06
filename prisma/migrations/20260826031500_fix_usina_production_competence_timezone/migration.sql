BEGIN;

UPDATE "UsinaProductionFact"
SET
  "competence" = DATE_TRUNC(
    'month',
    "occurredAt" AT TIME ZONE 'America/Sao_Paulo'
  )::DATE,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "competence" IS DISTINCT FROM DATE_TRUNC(
  'month',
  "occurredAt" AT TIME ZONE 'America/Sao_Paulo'
)::DATE;

COMMIT;
