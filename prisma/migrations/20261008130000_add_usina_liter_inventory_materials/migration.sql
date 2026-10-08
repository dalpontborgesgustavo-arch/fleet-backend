ALTER TABLE "TopographyInventoryMaterial"
  ADD COLUMN "availableFromCompetence" DATE;

INSERT INTO "TopographyInventoryMaterial"
  ("id", "company", "name", "aethosItemCode", "aethosDescription", "density", "inputUnit", "active", "sortOrder", "availableFromCompetence", "createdAt", "updatedAt")
VALUES
  ('ti-material-usina-oleo-diesel', 'USINA_JR', 'Óleo Diesel', NULL, NULL, NULL, 'LITER', true, 260, DATE '2026-09-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ti-material-usina-cm-imprima', 'USINA_JR', 'CM Imprima', NULL, NULL, NULL, 'LITER', true, 270, DATE '2026-09-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ti-material-usina-rr2c', 'USINA_JR', 'RR-2C', NULL, NULL, NULL, 'LITER', true, 280, DATE '2026-09-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
