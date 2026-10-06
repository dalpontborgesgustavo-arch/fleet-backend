-- O modo de ajuda passou a existir somente nesta entrega. Divergencias antigas
-- entre executor e responsavel atual nao comprovam que houve ajuda intencional.
UPDATE "Checklist"
SET "assisted_execution" = FALSE
WHERE "type"::text = 'MONTHLY'
  AND "createdAt" < TIMESTAMPTZ '2026-09-03 19:20:00+00';
