BEGIN;

-- Duplicidade sem vínculos operacionais identificada em 29/07/2026.
-- Remove o cadastro classificado como Asfalto e preserva o de Caminhões.
DELETE FROM "Vehicle" duplicado
WHERE duplicado."id" = 'd5a6bdae-2bcb-4d40-b419-6e0cc9040e56'
  AND duplicado."fleet" = '23'
  AND UPPER(REGEXP_REPLACE(duplicado."plate", '[^A-Za-z0-9]', '', 'g')) = 'IPM7A28'
  AND duplicado."tipoFrota" = 'Asfalto'
  AND NOT EXISTS (
    SELECT 1
    FROM "Occurrence" ocorrencia
    WHERE ocorrencia."vehicleId" = duplicado."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "ChecklistConsent" consentimento
    WHERE consentimento."vehicleId" = duplicado."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "Checklist" checklist
    WHERE checklist."vehicleId" = duplicado."id"
  );

CREATE UNIQUE INDEX "Vehicle_plate_normalized_key"
ON "Vehicle" (
  UPPER(REGEXP_REPLACE("plate", '[^A-Za-z0-9]', '', 'g'))
)
WHERE NULLIF(TRIM("plate"), '') IS NOT NULL;

CREATE UNIQUE INDEX "Vehicle_fleet_normalized_key"
ON "Vehicle" (
  UPPER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(TRIM("fleet"), '^FROTA[[:space:]-]*', '', 'i'),
      '[^A-Za-z0-9]',
      '',
      'g'
    )
  )
)
WHERE NULLIF(TRIM("fleet"), '') IS NOT NULL;

COMMIT;
