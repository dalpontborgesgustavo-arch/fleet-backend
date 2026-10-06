BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "UsinaBomStructure" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "unitId" TEXT,
  "aethosProductId" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdById" TEXT,
  "updatedById" TEXT,
  "inactivatedById" TEXT,
  "inactivatedAt" TIMESTAMP(3),
  "inactivationReason" TEXT,
  "deletedAt" TIMESTAMP(3),
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsinaBomStructure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaBomStructure_product_code_positive" CHECK ("aethosProductId" > 0),
  CONSTRAINT "UsinaBomStructure_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomStructure_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomStructure_inactivatedById_fkey" FOREIGN KEY ("inactivatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomStructure_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "UsinaBomVersion" (
  "id" TEXT NOT NULL,
  "structureId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "traceName" TEXT NOT NULL,
  "validFrom" DATE NOT NULL,
  "validTo" DATE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdById" TEXT,
  "updatedById" TEXT,
  "inactivatedById" TEXT,
  "inactivatedAt" TIMESTAMP(3),
  "inactivationReason" TEXT,
  "deletedAt" TIMESTAMP(3),
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsinaBomVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaBomVersion_version_positive" CHECK ("version" > 0),
  CONSTRAINT "UsinaBomVersion_valid_period" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom"),
  CONSTRAINT "UsinaBomVersion_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "UsinaBomStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomVersion_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomVersion_inactivatedById_fkey" FOREIGN KEY ("inactivatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomVersion_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "UsinaBomComponent" (
  "id" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "aethosMaterialId" INTEGER NOT NULL,
  "materialName" TEXT NOT NULL,
  "consumptionPercent" DECIMAL(12,6) NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdById" TEXT,
  "updatedById" TEXT,
  "deletedAt" TIMESTAMP(3),
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsinaBomComponent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaBomComponent_material_code_positive" CHECK ("aethosMaterialId" > 0),
  CONSTRAINT "UsinaBomComponent_consumption_range" CHECK ("consumptionPercent" > 0 AND "consumptionPercent" <= 100),
  CONSTRAINT "UsinaBomComponent_sort_order_positive" CHECK ("sortOrder" > 0),
  CONSTRAINT "UsinaBomComponent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "UsinaBomVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomComponent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomComponent_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomComponent_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "UsinaBomAudit" (
  "id" TEXT NOT NULL,
  "structureId" TEXT NOT NULL,
  "versionId" TEXT,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "snapshot" JSONB,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaBomAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaBomAudit_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "UsinaBomStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomAudit_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "UsinaBomVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaBomAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UsinaBomStructure_context_product_active_key"
  ON "UsinaBomStructure" (
    COALESCE("companyId", ''),
    COALESCE("unitId", ''),
    "aethosProductId"
  )
  WHERE "deletedAt" IS NULL;

CREATE INDEX "UsinaBomStructure_aethosProductId_idx" ON "UsinaBomStructure"("aethosProductId");
CREATE INDEX "UsinaBomStructure_companyId_unitId_active_idx" ON "UsinaBomStructure"("companyId", "unitId", "active");
CREATE INDEX "UsinaBomStructure_deletedAt_idx" ON "UsinaBomStructure"("deletedAt");
CREATE UNIQUE INDEX "UsinaBomVersion_structureId_version_key" ON "UsinaBomVersion"("structureId", "version");
CREATE UNIQUE INDEX "UsinaBomVersion_one_current_key" ON "UsinaBomVersion"("structureId") WHERE "active" = TRUE AND "deletedAt" IS NULL;
CREATE INDEX "UsinaBomVersion_structureId_active_idx" ON "UsinaBomVersion"("structureId", "active");
CREATE INDEX "UsinaBomVersion_validFrom_validTo_idx" ON "UsinaBomVersion"("validFrom", "validTo");
CREATE INDEX "UsinaBomVersion_deletedAt_idx" ON "UsinaBomVersion"("deletedAt");
CREATE UNIQUE INDEX "UsinaBomComponent_versionId_aethosMaterialId_key" ON "UsinaBomComponent"("versionId", "aethosMaterialId");
CREATE INDEX "UsinaBomComponent_versionId_sortOrder_idx" ON "UsinaBomComponent"("versionId", "sortOrder");
CREATE INDEX "UsinaBomComponent_aethosMaterialId_idx" ON "UsinaBomComponent"("aethosMaterialId");
CREATE INDEX "UsinaBomComponent_deletedAt_idx" ON "UsinaBomComponent"("deletedAt");
CREATE INDEX "UsinaBomAudit_structureId_createdAt_idx" ON "UsinaBomAudit"("structureId", "createdAt");
CREATE INDEX "UsinaBomAudit_versionId_idx" ON "UsinaBomAudit"("versionId");
CREATE INDEX "UsinaBomAudit_actorId_idx" ON "UsinaBomAudit"("actorId");

ALTER TABLE "UsinaBomVersion"
  ADD CONSTRAINT "UsinaBomVersion_no_overlapping_validity"
  EXCLUDE USING gist (
    "structureId" WITH =,
    daterange("validFrom", COALESCE("validTo", 'infinity'::date), '[]') WITH &&
  )
  WHERE ("deletedAt" IS NULL);

CREATE OR REPLACE FUNCTION "validate_usina_bom_component_total"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_version_id TEXT;
  component_total NUMERIC(12,6);
  version_is_visible BOOLEAN;
BEGIN
  target_version_id := COALESCE(NEW."versionId", OLD."versionId");

  SELECT ("deletedAt" IS NULL)
    INTO version_is_visible
    FROM "UsinaBomVersion"
   WHERE "id" = target_version_id;

  IF COALESCE(version_is_visible, FALSE) THEN
    SELECT COALESCE(SUM("consumptionPercent"), 0)
      INTO component_total
      FROM "UsinaBomComponent"
     WHERE "versionId" = target_version_id
       AND "deletedAt" IS NULL;

    IF component_total <> 100.000000 THEN
      RAISE EXCEPTION 'A soma dos componentes da versao % deve ser exatamente 100%%; total atual: %', target_version_id, component_total;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "UsinaBomComponent_total_100_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "UsinaBomComponent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "validate_usina_bom_component_total"();

CREATE SCHEMA IF NOT EXISTS "bi";

CREATE OR REPLACE VIEW "bi"."usina_bom_estrutura" AS
SELECT
  s."companyId" AS empresa_id,
  s."unitId" AS filial_id,
  s."id" AS id_estrutura,
  s."aethosProductId" AS id_item_asfalto,
  v."traceName" AS traco,
  v."version" AS versao,
  v."validFrom" AS vigencia_inicio,
  v."validTo" AS vigencia_fim,
  (s."active" AND v."active") AS estrutura_ativa,
  c."aethosMaterialId" AS id_item_mp,
  c."materialName" AS materia_prima,
  c."consumptionPercent" AS consumo_percentual,
  c."sortOrder" AS ordem,
  v."createdAt" AS criado_em,
  GREATEST(s."updatedAt", v."updatedAt", c."updatedAt") AS alterado_em
FROM "UsinaBomStructure" s
JOIN "UsinaBomVersion" v ON v."structureId" = s."id"
JOIN "UsinaBomComponent" c ON c."versionId" = v."id"
WHERE s."deletedAt" IS NULL
  AND v."deletedAt" IS NULL
  AND c."deletedAt" IS NULL;

COMMENT ON TABLE "UsinaBomStructure" IS
  'Estruturas BOM da Usina. A carga inicial usa vigencia em 2025-01-01 porque estes tracos serviram de base para os calculos de 2025.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    GRANT USAGE ON SCHEMA bi TO powerbi_reader;
    GRANT SELECT ON bi.usina_bom_estrutura TO powerbi_reader;
  END IF;
END $$;

COMMIT;
