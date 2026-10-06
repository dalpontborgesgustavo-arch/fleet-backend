WITH existing AS (
  SELECT *
  FROM "CostPurchaseManagerialItemMapping"
  WHERE "aethosItemId" = 1587
    AND "validFrom" = DATE '2025-01-01'
), upserted AS (
  INSERT INTO "CostPurchaseManagerialItemMapping" (
    "id",
    "aethosItemId",
    "category",
    "validFrom",
    "validTo",
    "reason",
    "active",
    "deletedAt",
    "createdBy",
    "updatedBy",
    "updatedAt"
  )
  VALUES (
    md5('cost-purchases-managerial:1587:2025-01-01')::uuid::text,
    1587,
    'RR',
    DATE '2025-01-01',
    NULL,
    'Emulsao asfaltica RR2C confirmada como RR em CUSTOS-COMPRAS-PC-009',
    true,
    NULL,
    'SYSTEM_MIGRATION',
    'SYSTEM_MIGRATION',
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("aethosItemId", "validFrom") DO UPDATE SET
    "category" = EXCLUDED."category",
    "validTo" = EXCLUDED."validTo",
    "reason" = EXCLUDED."reason",
    "active" = true,
    "deletedAt" = NULL,
    "updatedBy" = EXCLUDED."updatedBy",
    "updatedAt" = CURRENT_TIMESTAMP
  RETURNING *
)
INSERT INTO "CostPurchaseManagerialItemMappingAudit" (
  "mappingId",
  "operation",
  "beforeData",
  "afterData",
  "actorId"
)
SELECT
  upserted."id",
  CASE WHEN existing."id" IS NULL THEN 'CREATE' ELSE 'UPDATE' END,
  CASE WHEN existing."id" IS NULL THEN NULL ELSE to_jsonb(existing) END,
  to_jsonb(upserted),
  'SYSTEM_MIGRATION'
FROM upserted
LEFT JOIN existing ON true;
