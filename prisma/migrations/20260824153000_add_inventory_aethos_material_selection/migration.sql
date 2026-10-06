CREATE UNIQUE INDEX IF NOT EXISTS "TopographyInventoryMaterial_company_aethosItemCode_key"
  ON "TopographyInventoryMaterial"("company", "aethosItemCode");

INSERT INTO "TopographyInventoryMaterial" (
  "id",
  "company",
  "name",
  "aethosItemCode",
  "aethosDescription",
  "density",
  "inputUnit",
  "active",
  "sortOrder",
  "updatedAt"
) VALUES (
  'ti-material-usina-cap-borracha',
  'USINA_JR',
  'CAP Borracha',
  '5525',
  'CAP BORRACHA (USINA)',
  NULL,
  'TON',
  true,
  220,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("company", "name") DO UPDATE SET
  "aethosItemCode" = EXCLUDED."aethosItemCode",
  "aethosDescription" = EXCLUDED."aethosDescription",
  "density" = EXCLUDED."density",
  "inputUnit" = EXCLUDED."inputUnit",
  "active" = EXCLUDED."active",
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;
