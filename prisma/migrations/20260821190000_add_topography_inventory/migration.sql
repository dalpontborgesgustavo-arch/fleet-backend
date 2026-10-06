CREATE TABLE IF NOT EXISTS "TopographyInventoryMaterial" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aethosItemCode" TEXT,
    "aethosDescription" TEXT,
    "density" DECIMAL(10,4),
    "inputUnit" TEXT NOT NULL DEFAULT 'M3',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TopographyInventoryMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TopographyInventory" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "referenceYear" INTEGER NOT NULL,
    "referenceMonth" INTEGER NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TopographyInventory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TopographyInventoryItem" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "volumeM3" DECIMAL(18,3) NOT NULL,
    "densitySnapshot" DECIMAL(10,4),
    "tonnage" DECIMAL(18,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TopographyInventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TopographyInventoryHistory" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopographyInventoryHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TopographyInventoryMaterial_company_name_key"
  ON "TopographyInventoryMaterial"("company", "name");
CREATE INDEX IF NOT EXISTS "TopographyInventoryMaterial_company_active_sortOrder_idx"
  ON "TopographyInventoryMaterial"("company", "active", "sortOrder");
CREATE INDEX IF NOT EXISTS "TopographyInventoryMaterial_aethosItemCode_idx"
  ON "TopographyInventoryMaterial"("aethosItemCode");

CREATE UNIQUE INDEX IF NOT EXISTS "TopographyInventory_company_referenceYear_referenceMonth_key"
  ON "TopographyInventory"("company", "referenceYear", "referenceMonth");
CREATE INDEX IF NOT EXISTS "TopographyInventory_company_referenceYear_referenceMonth_idx"
  ON "TopographyInventory"("company", "referenceYear", "referenceMonth");
CREATE INDEX IF NOT EXISTS "TopographyInventory_measuredAt_idx"
  ON "TopographyInventory"("measuredAt");
CREATE INDEX IF NOT EXISTS "TopographyInventory_createdById_idx"
  ON "TopographyInventory"("createdById");
CREATE INDEX IF NOT EXISTS "TopographyInventory_updatedById_idx"
  ON "TopographyInventory"("updatedById");

CREATE UNIQUE INDEX IF NOT EXISTS "TopographyInventoryItem_inventoryId_materialId_key"
  ON "TopographyInventoryItem"("inventoryId", "materialId");
CREATE INDEX IF NOT EXISTS "TopographyInventoryItem_inventoryId_idx"
  ON "TopographyInventoryItem"("inventoryId");
CREATE INDEX IF NOT EXISTS "TopographyInventoryItem_materialId_idx"
  ON "TopographyInventoryItem"("materialId");

CREATE INDEX IF NOT EXISTS "TopographyInventoryHistory_inventoryId_createdAt_idx"
  ON "TopographyInventoryHistory"("inventoryId", "createdAt");
CREATE INDEX IF NOT EXISTS "TopographyInventoryHistory_actorId_idx"
  ON "TopographyInventoryHistory"("actorId");

DO $$ BEGIN
  ALTER TABLE "TopographyInventory"
    ADD CONSTRAINT "TopographyInventory_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TopographyInventory"
    ADD CONSTRAINT "TopographyInventory_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TopographyInventoryItem"
    ADD CONSTRAINT "TopographyInventoryItem_inventoryId_fkey"
    FOREIGN KEY ("inventoryId") REFERENCES "TopographyInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TopographyInventoryItem"
    ADD CONSTRAINT "TopographyInventoryItem_materialId_fkey"
    FOREIGN KEY ("materialId") REFERENCES "TopographyInventoryMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TopographyInventoryHistory"
    ADD CONSTRAINT "TopographyInventoryHistory_inventoryId_fkey"
    FOREIGN KEY ("inventoryId") REFERENCES "TopographyInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TopographyInventoryHistory"
    ADD CONSTRAINT "TopographyInventoryHistory_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "TopographyInventoryMaterial" (
  "id", "company", "name", "aethosItemCode", "aethosDescription", "density", "inputUnit", "active", "sortOrder", "updatedAt"
) VALUES
  ('ti-material-usina-brita-34', 'USINA_JR', 'Brita 3/4', '1465', 'BRITA 3/4 OU BRITA 1', 1.5000, 'M3', true, 10, CURRENT_TIMESTAMP),
  ('ti-material-usina-pedrisco', 'USINA_JR', 'Pedrisco', '111', 'PEDRISCO', 1.4800, 'M3', true, 20, CURRENT_TIMESTAMP),
  ('ti-material-usina-po-pedra', 'USINA_JR', 'Pó de Pedra', '968', 'PO DE PEDRA', 1.5800, 'M3', true, 30, CURRENT_TIMESTAMP),
  ('ti-material-usina-rejeito-asfalto', 'USINA_JR', 'Rejeito de Asfalto', '2208', 'REJEITO ASFALTO (REVENDA)', 1.5000, 'M3', true, 40, CURRENT_TIMESTAMP),
  ('ti-material-usina-macadame', 'USINA_JR', 'Macadame', '90', 'MACADAME (BRITA 4)', 1.7300, 'M3', true, 50, CURRENT_TIMESTAMP),
  ('ti-material-usina-base', 'USINA_JR', 'Base', NULL, NULL, 1.6500, 'M3', true, 60, CURRENT_TIMESTAMP),
  ('ti-material-usina-argamassa', 'USINA_JR', 'Argamassa', '978', 'ARGAMASSA M3', 1.5260, 'M3', true, 70, CURRENT_TIMESTAMP),
  ('ti-material-usina-massa-fina', 'USINA_JR', 'Massa Fina', '544', 'AREIA MASSA FINA', 1.4000, 'M3', true, 80, CURRENT_TIMESTAMP),
  ('ti-material-usina-areia-media', 'USINA_JR', 'Areia Média', '13781', 'AREIA MEDIA INDUSTRIAL', 1.5130, 'M3', true, 90, CURRENT_TIMESTAMP),
  ('ti-material-usina-areia-fina', 'USINA_JR', 'Areia Fina', '2', 'AREIA FINA', 1.5360, 'M3', true, 100, CURRENT_TIMESTAMP),
  ('ti-material-usina-areia-fina-grossa', 'USINA_JR', 'Areia Fina da Grossa', '53', 'AREIA FINA DA GROSSA', 1.3900, 'M3', true, 110, CURRENT_TIMESTAMP),
  ('ti-material-usina-areia-barrenta', 'USINA_JR', 'Areia Barrenta', '114', 'AREIA BARRENTA', 1.6000, 'M3', true, 120, CURRENT_TIMESTAMP),
  ('ti-material-usina-areao', 'USINA_JR', 'Areão', '5', 'AREIAO (SAIBRO)', 1.7200, 'M3', true, 130, CURRENT_TIMESTAMP),
  ('ti-material-usina-seixo', 'USINA_JR', 'Seixo', NULL, NULL, 1.9000, 'M3', true, 140, CURRENT_TIMESTAMP),
  ('ti-material-usina-bica', 'USINA_JR', 'Bica', '110', 'BICA CORRIDA', 1.6500, 'M3', true, 150, CURRENT_TIMESTAMP),
  ('ti-material-usina-rachao', 'USINA_JR', 'Rachão', '164', 'RACHAO M3', 1.7300, 'M3', true, 160, CURRENT_TIMESTAMP),
  ('ti-material-usina-fresagem-asfalto', 'USINA_JR', 'Fresagem de Asfalto', NULL, NULL, 1.2200, 'M3', true, 170, CURRENT_TIMESTAMP),
  ('ti-material-usina-mistura-micro', 'USINA_JR', 'Mistura para Micro Revestimento CCR', '13363', 'MISTURA AGREGADA MICRO REVESTIMENTO', NULL, 'M3', true, 180, CURRENT_TIMESTAMP),

  ('ti-material-pedra-pedrisco-falchetti', 'PEDRAFORTE', 'Pedrisco (Falchetti)', NULL, NULL, 1.4800, 'M3', true, 10, CURRENT_TIMESTAMP),
  ('ti-material-pedra-travamento-ccr', 'PEDRAFORTE', 'Travamento CCR', NULL, NULL, NULL, 'M3', true, 20, CURRENT_TIMESTAMP),
  ('ti-material-pedra-base-graduada', 'PEDRAFORTE', 'Base Graduada (Carregadeira)', NULL, NULL, 1.6500, 'M3', true, 30, CURRENT_TIMESTAMP),
  ('ti-material-pedra-brita-2', 'PEDRAFORTE', 'Brita 2', NULL, NULL, 1.4200, 'M3', true, 40, CURRENT_TIMESTAMP),
  ('ti-material-pedra-areia-fina', 'PEDRAFORTE', 'Areia Fina', NULL, NULL, 1.5400, 'M3', true, 50, CURRENT_TIMESTAMP),
  ('ti-material-pedra-areia-media', 'PEDRAFORTE', 'Areia Média (Industrial)', NULL, NULL, 1.5100, 'M3', true, 60, CURRENT_TIMESTAMP),
  ('ti-material-pedra-fresado-ccr', 'PEDRAFORTE', 'Fresado CCR', NULL, NULL, 1.2200, 'M3', true, 70, CURRENT_TIMESTAMP),
  ('ti-material-pedra-pedrisco-ugioni', 'PEDRAFORTE', 'Pedrisco (Ugioni)', NULL, NULL, 1.4800, 'M3', true, 80, CURRENT_TIMESTAMP),
  ('ti-material-pedra-refugo-brita-34', 'PEDRAFORTE', 'Refugo Brita 3/4 (Rejeito)', NULL, NULL, 1.5000, 'M3', true, 90, CURRENT_TIMESTAMP),
  ('ti-material-pedra-refugo-brita-2', 'PEDRAFORTE', 'Refugo Brita 2 (Rejeito)', NULL, NULL, 1.4200, 'M3', true, 100, CURRENT_TIMESTAMP),
  ('ti-material-pedra-mataco', 'PEDRAFORTE', 'Matacão (Detonação)', NULL, NULL, NULL, 'M3', true, 110, CURRENT_TIMESTAMP),
  ('ti-material-pedra-bica-corrida', 'PEDRAFORTE', 'Bica Corrida', NULL, NULL, 1.6500, 'M3', true, 120, CURRENT_TIMESTAMP),
  ('ti-material-pedra-po-eliane', 'PEDRAFORTE', 'Pó de Pedra (ELIANE)', NULL, NULL, 1.5800, 'M3', true, 130, CURRENT_TIMESTAMP),
  ('ti-material-pedra-po-estoque', 'PEDRAFORTE', 'Pó de Pedra (ESTOQUE)', NULL, NULL, 1.5800, 'M3', true, 140, CURRENT_TIMESTAMP),
  ('ti-material-pedra-macadame', 'PEDRAFORTE', 'Macadame', NULL, NULL, 1.7300, 'M3', true, 150, CURRENT_TIMESTAMP),
  ('ti-material-pedra-material-contaminado', 'PEDRAFORTE', 'Material Contaminado (Baixo das Correias)', NULL, NULL, NULL, 'M3', true, 160, CURRENT_TIMESTAMP)
ON CONFLICT ("company", "name") DO UPDATE SET
  "aethosItemCode" = EXCLUDED."aethosItemCode",
  "aethosDescription" = EXCLUDED."aethosDescription",
  "density" = EXCLUDED."density",
  "inputUnit" = EXCLUDED."inputUnit",
  "active" = EXCLUDED."active",
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "TopographyInventory" (
  "id", "company", "referenceYear", "referenceMonth", "measuredAt", "source", "updatedAt"
) VALUES
  ('ti-inventory-usina-2026-07', 'USINA_JR', 2026, 7, '2026-07-31T18:40:00.000Z', 'LEGACY_SPREADSHEET', CURRENT_TIMESTAMP),
  ('ti-inventory-pedra-2026-07', 'PEDRAFORTE', 2026, 7, '2026-08-03T14:00:00.000Z', 'LEGACY_SPREADSHEET', CURRENT_TIMESTAMP)
ON CONFLICT ("company", "referenceYear", "referenceMonth") DO NOTHING;

INSERT INTO "TopographyInventoryItem" (
  "id", "inventoryId", "materialId", "volumeM3", "densitySnapshot", "tonnage", "updatedAt"
) VALUES
  ('ti-item-usina-2026-07-brita-34', 'ti-inventory-usina-2026-07', 'ti-material-usina-brita-34', 661.520, 1.5000, 992.280, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-pedrisco', 'ti-inventory-usina-2026-07', 'ti-material-usina-pedrisco', 343.890, 1.4800, 508.957, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-po-pedra', 'ti-inventory-usina-2026-07', 'ti-material-usina-po-pedra', 1200.000, 1.5800, 1896.000, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-rejeito-asfalto', 'ti-inventory-usina-2026-07', 'ti-material-usina-rejeito-asfalto', 2778.300, 1.5000, 4167.450, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-macadame', 'ti-inventory-usina-2026-07', 'ti-material-usina-macadame', 182.930, 1.7300, 316.469, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-base', 'ti-inventory-usina-2026-07', 'ti-material-usina-base', 0.000, 1.6500, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-argamassa', 'ti-inventory-usina-2026-07', 'ti-material-usina-argamassa', 36.070, 1.5260, 55.043, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-massa-fina', 'ti-inventory-usina-2026-07', 'ti-material-usina-massa-fina', 60.490, 1.4000, 84.686, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-areia-media', 'ti-inventory-usina-2026-07', 'ti-material-usina-areia-media', 102.970, 1.5130, 155.794, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-areia-fina', 'ti-inventory-usina-2026-07', 'ti-material-usina-areia-fina', 510.690, 1.5360, 784.420, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-areia-fina-grossa', 'ti-inventory-usina-2026-07', 'ti-material-usina-areia-fina-grossa', 0.000, 1.3900, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-areia-barrenta', 'ti-inventory-usina-2026-07', 'ti-material-usina-areia-barrenta', 0.000, 1.6000, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-areao', 'ti-inventory-usina-2026-07', 'ti-material-usina-areao', 46.230, 1.7200, 79.516, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-seixo', 'ti-inventory-usina-2026-07', 'ti-material-usina-seixo', 0.000, 1.9000, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-bica', 'ti-inventory-usina-2026-07', 'ti-material-usina-bica', 10.320, 1.6500, 17.028, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-rachao', 'ti-inventory-usina-2026-07', 'ti-material-usina-rachao', 0.000, 1.7300, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-fresagem-asfalto', 'ti-inventory-usina-2026-07', 'ti-material-usina-fresagem-asfalto', 741.930, 1.2200, 905.155, CURRENT_TIMESTAMP),
  ('ti-item-usina-2026-07-mistura-micro', 'ti-inventory-usina-2026-07', 'ti-material-usina-mistura-micro', 98.760, NULL, NULL, CURRENT_TIMESTAMP),

  ('ti-item-pedra-2026-07-pedrisco-falchetti', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-pedrisco-falchetti', 0.000, 1.4800, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-travamento-ccr', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-travamento-ccr', 0.000, NULL, NULL, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-base-graduada', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-base-graduada', 1532.260, 1.6500, 2528.229, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-brita-2', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-brita-2', 585.160, 1.4200, 830.927, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-areia-fina', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-areia-fina', 54.550, 1.5400, 84.007, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-areia-media', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-areia-media', 493.670, 1.5100, 745.442, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-fresado-ccr', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-fresado-ccr', 0.000, 1.2200, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-pedrisco-ugioni', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-pedrisco-ugioni', 0.000, 1.4800, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-refugo-brita-34', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-refugo-brita-34', 191.590, 1.5000, 287.385, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-refugo-brita-2', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-refugo-brita-2', 0.000, 1.4200, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-mataco', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-mataco', 0.000, NULL, NULL, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-bica-corrida', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-bica-corrida', 0.000, 1.6500, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-po-eliane', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-po-eliane', 0.000, 1.5800, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-po-estoque', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-po-estoque', 9.550, 1.5800, 15.089, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-macadame', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-macadame', 0.000, 1.7300, 0.000, CURRENT_TIMESTAMP),
  ('ti-item-pedra-2026-07-material-contaminado', 'ti-inventory-pedra-2026-07', 'ti-material-pedra-material-contaminado', 0.000, NULL, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("inventoryId", "materialId") DO NOTHING;
