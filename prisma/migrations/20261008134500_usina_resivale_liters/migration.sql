-- Preserve the historical tonnage records and their Aethos code 3024.
-- The September 2026 source provides a measured quantity in liters, and no
-- certified density is available for converting it to tonnes.
UPDATE "TopographyInventoryMaterial"
SET "availableThroughCompetence" = DATE '2026-08-01',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'bca19b93-a2e1-4ddb-af34-e9791b7906da';

INSERT INTO "TopographyInventoryMaterial"
  ("id", "company", "name", "aethosItemCode", "aethosDescription", "density", "inputUnit", "availableFromCompetence", "active", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('ti-material-usina-oleo-resivale-litros', 'USINA_JR', 'Óleo Resivale RRII (litros)', NULL, 'Referência histórica Aethos 3024; unidade da planilha: L', NULL, 'LITER', DATE '2026-09-01', true, 230, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
