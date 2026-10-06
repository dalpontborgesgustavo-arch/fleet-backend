UPDATE "TopographyInventoryMaterial"
SET
  "density" = 1.4200,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'ti-material-usina-mistura-micro';

UPDATE "TopographyInventoryItem"
SET
  "densitySnapshot" = 1.4200,
  "tonnage" = ROUND("volumeM3" * 1.4200, 3),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "materialId" = 'ti-material-usina-mistura-micro';
