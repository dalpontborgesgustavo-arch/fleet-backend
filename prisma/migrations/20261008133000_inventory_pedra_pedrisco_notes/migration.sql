ALTER TABLE "TopographyInventoryMaterial"
  ADD COLUMN "availableThroughCompetence" DATE;

ALTER TABLE "TopographyInventory"
  ADD COLUMN "notes" TEXT;

UPDATE "TopographyInventoryMaterial"
SET "availableThroughCompetence" = DATE '2026-08-01',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'ti-material-pedra-pedrisco-falchetti',
  'ti-material-pedra-pedrisco-ugioni'
);

-- September's source reports the pedrisco volumes in m3, while Aethos
-- identifies the consolidated stock with item 9310 (unit TN). Keep the
-- inventory input in m3 and retain the existing 1.48 t/m3 density snapshot.
INSERT INTO "TopographyInventoryMaterial"
  ("id", "company", "name", "aethosItemCode", "aethosDescription", "density", "inputUnit", "availableFromCompetence", "active", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('ti-material-pedra-pedrisco-9310', 'PEDRAFORTE', 'Pedrisco', '9310', 'PEDRISCO', 1.4800, 'M3', DATE '2026-09-01', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
