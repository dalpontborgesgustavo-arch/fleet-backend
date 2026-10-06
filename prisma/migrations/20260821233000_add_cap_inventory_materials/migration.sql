INSERT INTO "TopographyInventoryMaterial" (
  "id", "company", "name", "aethosItemCode", "aethosDescription", "density", "inputUnit", "active", "sortOrder", "updatedAt"
) VALUES
  ('ti-material-usina-cap-5070', 'USINA_JR', 'CAP 50/70', '1813', 'CAP 50/70', NULL, 'TON', true, 190, CURRENT_TIMESTAMP),
  ('ti-material-usina-cap-polimero', 'USINA_JR', 'CAP Polímero', '5643', 'CAP Polimero', NULL, 'TON', true, 200, CURRENT_TIMESTAMP),
  ('ti-material-usina-cap-alto-modulo', 'USINA_JR', 'CAP Alto Módulo', '13861', 'CAP Alto Modulo', NULL, 'TON', true, 210, CURRENT_TIMESTAMP)
ON CONFLICT ("company", "name") DO UPDATE SET
  "aethosItemCode" = EXCLUDED."aethosItemCode",
  "aethosDescription" = EXCLUDED."aethosDescription",
  "density" = EXCLUDED."density",
  "inputUnit" = EXCLUDED."inputUnit",
  "active" = EXCLUDED."active",
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;
