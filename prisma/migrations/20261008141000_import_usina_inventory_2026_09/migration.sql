-- Source: ESTOQUE USINA JR - SETEMBRO.xlsx, PLANILHA MED - USINA,
-- competence 2026-09, measured 2026-10-01 13:20 America/Sao_Paulo.
-- SHA256: 9A1B186C1EF7E068E009A05B2D00C9E60481C36D4278056D40F00C5732F280A7
-- M3 stock uses the catalog density. CAP 50/70 source liters use the existing
-- 1.000 kg/L conversion; Cal CH1 and DOP source kilograms become tonnes.
-- Other liquids retain source liters without fabricated density or tonnage.
DO $$
DECLARE
  inventory_id TEXT := 'ti-inventory-usina-2026-09';
  inserted_count INTEGER;
  inventory_notes TEXT := 'Importação da planilha de setembro/2026. Óleo Diesel 3.500 L, CM Imprima 3.279 L, RR-2C 31.184 L e Óleo Resivale RRII 23.565 L registrados em litros; tonelagem pendente de densidade oficial. O histórico de Óleo Resivale em toneladas foi preservado. CAP 50/70: 90.792 L convertidos pela regra existente (1,000 kg/L). Cal CH1: 14.000 kg = 14 t; DOP: 620 kg = 0,620 t. CAP Alto Módulo não constava na planilha e ficou sem medição; Heat Transfer Oil S2, ausente do cadastro, constava zerado e não foi lançado. Total em toneladas parcial.';
BEGIN
  IF EXISTS (
    SELECT 1 FROM "TopographyInventory"
    WHERE "company" = 'USINA_JR' AND "referenceYear" = 2026 AND "referenceMonth" = 9
  ) THEN
    RAISE EXCEPTION 'Usina JR September inventory already exists; refusing to overwrite';
  END IF;

  INSERT INTO "TopographyInventory"
    ("id", "company", "referenceYear", "referenceMonth", "measuredAt", "source", "notes", "createdAt", "updatedAt")
  VALUES
    (inventory_id, 'USINA_JR', 2026, 9, TIMESTAMP '2026-10-01 16:20:00', 'LEGACY_SPREADSHEET_PARTIAL', inventory_notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

  WITH source_values ("materialId", quantity) AS (
    VALUES
      ('ti-material-usina-brita-34', 767.940::DECIMAL),
      ('ti-material-usina-pedrisco', 490.600::DECIMAL),
      ('ti-material-usina-po-pedra', 563.920::DECIMAL),
      ('ti-material-usina-rejeito-asfalto', 3311.800::DECIMAL),
      ('ti-material-usina-macadame', 63.380::DECIMAL),
      ('ti-material-usina-base', 0.000::DECIMAL),
      ('ti-material-usina-argamassa', 33.310::DECIMAL),
      ('ti-material-usina-massa-fina', 53.635::DECIMAL),
      ('ti-material-usina-areia-media', 207.080::DECIMAL),
      ('ti-material-usina-areia-fina', 69.346::DECIMAL),
      ('ti-material-usina-areia-fina-grossa', 0.000::DECIMAL),
      ('ti-material-usina-areia-barrenta', 0.000::DECIMAL),
      ('ti-material-usina-areao', 58.690::DECIMAL),
      ('ti-material-usina-seixo', 0.000::DECIMAL),
      ('ti-material-usina-bica', 15.950::DECIMAL),
      ('ti-material-usina-rachao', 0.000::DECIMAL),
      ('ti-material-usina-fresagem-asfalto', 755.610::DECIMAL),
      ('ti-material-usina-mistura-micro', 100.670::DECIMAL),
      ('ti-material-usina-cap-5070', 90.792::DECIMAL),
      ('ti-material-usina-cap-polimero', 0.000::DECIMAL),
      ('ti-material-usina-cap-borracha', 0.000::DECIMAL),
      ('ti-material-usina-oleo-resivale-litros', 23565.000::DECIMAL),
      ('1665ad61-3deb-49f6-aba1-51694b76d6e2', 14.000::DECIMAL),
      ('18cb93de-2c2d-41f4-acc2-1e86d2d9793e', 0.620::DECIMAL),
      ('ti-material-usina-oleo-diesel', 3500.000::DECIMAL),
      ('ti-material-usina-cm-imprima', 3279.000::DECIMAL),
      ('ti-material-usina-rr2c', 31184.000::DECIMAL)
  )
  INSERT INTO "TopographyInventoryItem"
    ("id", "inventoryId", "materialId", "volumeM3", "densitySnapshot", "tonnage", "createdAt", "updatedAt")
  SELECT
    inventory_id || ':' || v."materialId", inventory_id, v."materialId", v.quantity,
    m."density",
    CASE
      WHEN m."inputUnit" = 'TON' THEN v.quantity
      WHEN m."inputUnit" = 'LITER' THEN
        CASE WHEN m."density" IS NULL THEN NULL ELSE ROUND(v.quantity * m."density" / 1000, 3) END
      ELSE
        CASE WHEN m."density" IS NULL THEN NULL ELSE ROUND(v.quantity * m."density", 3) END
    END,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM source_values v
  JOIN "TopographyInventoryMaterial" m ON m."id" = v."materialId" AND m."company" = 'USINA_JR';

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count <> 27 THEN
    RAISE EXCEPTION 'Expected 27 Usina JR materials, inserted %', inserted_count;
  END IF;

  INSERT INTO "TopographyInventoryHistory"
    ("id", "inventoryId", "actorId", "action", "snapshot", "createdAt")
  VALUES
    (
      'ti-history-usina-2026-09-import', inventory_id, NULL, 'IMPORTED',
      jsonb_build_object(
        'before', NULL,
        'after', jsonb_build_object(
          'company', 'USINA_JR', 'referenceYear', 2026, 'referenceMonth', 9,
          'measuredAt', '2026-10-01T16:20:00.000Z', 'notes', inventory_notes,
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
        'sourceFile', 'ESTOQUE USINA JR - SETEMBRO.xlsx',
        'sourceSha256', '9A1B186C1EF7E068E009A05B2D00C9E60481C36D4278056D40F00C5732F280A7'
      ),
      CURRENT_TIMESTAMP
    );
END $$;
