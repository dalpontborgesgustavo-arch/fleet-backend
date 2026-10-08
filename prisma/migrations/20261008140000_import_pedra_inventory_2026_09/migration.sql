-- Source: ESTOQUE PEDRA FORTE - SETEMBRO.xlsx, PLANILHA MED - USINA,
-- competence 2026-09, measured 2026-10-01 11:21 America/Sao_Paulo.
-- SHA256: 660CC2E1BD12EAA0AF30DEFADA5AC095D2364768E11E1541E7B0DAE638B5AFE7
-- Only catalogued materials are imported. Explicit exceptions are recorded
-- in the inventory observation, so its aggregate totals remain partial.
DO $$
DECLARE
  inventory_id TEXT := 'ti-inventory-pedra-2026-09';
  inserted_count INTEGER;
  inventory_notes TEXT := 'Pedrisco consolidado no código Aethos 9310: Pedrisco 2.896,80 m³ + Pedrisco contaminado 0 + Pedrisco Ugioni 0 = 2.896,80 m³. Refugo Brita 3/4 (Rejeito) e Pó de Pedra (ELIANE) registrados como zero por orientação. Itens fora do cadastro não lançados: Brita 2 contaminada 59,91 m³; Brita 3/4 contaminada 95,48 m³; Pó de Pedra CERÂMICA 2.080,30 m³; Pó de Pedra AMOSTRA 19,61 m³. Total parcial.';
BEGIN
  IF EXISTS (
    SELECT 1 FROM "TopographyInventory"
    WHERE "company" = 'PEDRAFORTE' AND "referenceYear" = 2026 AND "referenceMonth" = 9
  ) THEN
    RAISE EXCEPTION 'Pedraforte September inventory already exists; refusing to overwrite';
  END IF;

  INSERT INTO "TopographyInventory"
    ("id", "company", "referenceYear", "referenceMonth", "measuredAt", "source", "notes", "createdAt", "updatedAt")
  VALUES
    (inventory_id, 'PEDRAFORTE', 2026, 9, TIMESTAMP '2026-10-01 14:21:00', 'LEGACY_SPREADSHEET_PARTIAL', inventory_notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

  WITH source_values ("materialId", quantity) AS (
    VALUES
      ('ti-material-pedra-pedrisco-9310', 2896.800::DECIMAL),
      ('ti-material-pedra-travamento-ccr', 0.000::DECIMAL),
      ('ti-material-pedra-base-graduada', 699.880::DECIMAL),
      ('ti-material-pedra-brita-2', 475.380::DECIMAL),
      ('ti-material-pedra-areia-fina', 0.000::DECIMAL),
      ('ti-material-pedra-areia-media', 108.260::DECIMAL),
      ('ti-material-pedra-fresado-ccr', 0.000::DECIMAL),
      ('ti-material-pedra-refugo-brita-34', 0.000::DECIMAL),
      ('ti-material-pedra-refugo-brita-2', 0.000::DECIMAL),
      ('ti-material-pedra-mataco', 0.000::DECIMAL),
      ('ti-material-pedra-bica-corrida', 0.000::DECIMAL),
      ('ti-material-pedra-po-eliane', 0.000::DECIMAL),
      ('ti-material-pedra-po-estoque', 0.000::DECIMAL),
      ('ti-material-pedra-macadame', 0.000::DECIMAL),
      ('ti-material-pedra-material-contaminado', 0.000::DECIMAL)
  )
  INSERT INTO "TopographyInventoryItem"
    ("id", "inventoryId", "materialId", "volumeM3", "densitySnapshot", "tonnage", "createdAt", "updatedAt")
  SELECT
    inventory_id || ':' || v."materialId", inventory_id, v."materialId", v.quantity,
    m."density",
    CASE WHEN m."density" IS NULL THEN NULL ELSE ROUND(v.quantity * m."density", 3) END,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM source_values v
  JOIN "TopographyInventoryMaterial" m ON m."id" = v."materialId" AND m."company" = 'PEDRAFORTE';

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count <> 15 THEN
    RAISE EXCEPTION 'Expected 15 Pedraforte materials, inserted %', inserted_count;
  END IF;

  INSERT INTO "TopographyInventoryHistory"
    ("id", "inventoryId", "actorId", "action", "snapshot", "createdAt")
  VALUES
    (
      'ti-history-pedra-2026-09-import', inventory_id, NULL, 'IMPORTED',
      jsonb_build_object(
        'before', NULL,
        'after', jsonb_build_object(
          'company', 'PEDRAFORTE', 'referenceYear', 2026, 'referenceMonth', 9,
          'measuredAt', '2026-10-01T14:21:00.000Z', 'notes', inventory_notes,
          'items', (
            SELECT jsonb_agg(jsonb_build_object(
              'materialId', i."materialId", 'volumeM3', i."volumeM3",
              'densitySnapshot', i."densitySnapshot", 'tonnage', i."tonnage"
            ) ORDER BY m."sortOrder")
            FROM "TopographyInventoryItem" i
            JOIN "TopographyInventoryMaterial" m ON m."id" = i."materialId"
            WHERE i."inventoryId" = inventory_id
          )
        ),
        'sourceFile', 'ESTOQUE PEDRA FORTE - SETEMBRO.xlsx',
        'sourceSha256', '660CC2E1BD12EAA0AF30DEFADA5AC095D2364768E11E1541E7B0DAE638B5AFE7'
      ),
      CURRENT_TIMESTAMP
    );
END $$;
