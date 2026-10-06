BEGIN;

CREATE TABLE "UsinaMonthlyCostConfig" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "competence" DATE NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT FALSE,
  "taxRate" DECIMAL(10,6) NOT NULL,
  "observation" TEXT,
  "changeReason" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "confirmedById" TEXT,
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "UsinaMonthlyCostConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMonthlyCostConfig_competence_first_day" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "UsinaMonthlyCostConfig_version_positive" CHECK ("version" > 0),
  CONSTRAINT "UsinaMonthlyCostConfig_status_valid" CHECK ("status" IN ('DRAFT', 'CONFIRMED')),
  CONSTRAINT "UsinaMonthlyCostConfig_tax_rate_valid" CHECK ("taxRate" > 0 AND "taxRate" <= 1),
  CONSTRAINT "UsinaMonthlyCostConfig_current_confirmed" CHECK (NOT "isCurrent" OR "status" = 'CONFIRMED'),
  CONSTRAINT "UsinaMonthlyCostConfig_confirmed_audit" CHECK (
    "status" <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL)
  ),
  CONSTRAINT "UsinaMonthlyCostConfig_change_reason" CHECK (
    "version" = 1 OR LENGTH(BTRIM(COALESCE("changeReason", ''))) > 0
  ),
  CONSTRAINT "UsinaMonthlyCostConfig_deleted_not_current" CHECK ("deletedAt" IS NULL OR NOT "isCurrent"),
  CONSTRAINT "UsinaMonthlyCostConfig_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyCostConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyCostConfig_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyCostConfig_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "UsinaMonthlyCostEquipment" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "equipmentType" TEXT NOT NULL,
  "fleetNumber" TEXT NOT NULL,
  "aethosVehicleId" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdById" TEXT,
  "updatedById" TEXT,
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "UsinaMonthlyCostEquipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMonthlyCostEquipment_type_valid" CHECK ("equipmentType" IN ('CARREGADEIRA', 'VEICULO_USINA')),
  CONSTRAINT "UsinaMonthlyCostEquipment_fleet_required" CHECK (LENGTH(BTRIM("fleetNumber")) > 0),
  CONSTRAINT "UsinaMonthlyCostEquipment_aethos_positive" CHECK ("aethosVehicleId" > 0),
  CONSTRAINT "UsinaMonthlyCostEquipment_order_positive" CHECK ("sortOrder" > 0),
  CONSTRAINT "UsinaMonthlyCostEquipment_configId_fkey" FOREIGN KEY ("configId") REFERENCES "UsinaMonthlyCostConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyCostEquipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyCostEquipment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyCostEquipment_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "UsinaMonthlyCostAudit" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "snapshot" JSONB,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaMonthlyCostAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMonthlyCostAudit_configId_fkey" FOREIGN KEY ("configId") REFERENCES "UsinaMonthlyCostConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyCostAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UsinaMonthlyCostConfig_context_competence_version_key"
  ON "UsinaMonthlyCostConfig"("companyId", "unitId", "competence", "version");
CREATE UNIQUE INDEX "UsinaMonthlyCostConfig_one_current_key"
  ON "UsinaMonthlyCostConfig"("companyId", "unitId", "competence")
  WHERE "isCurrent" = TRUE AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "UsinaMonthlyCostConfig_one_draft_key"
  ON "UsinaMonthlyCostConfig"("companyId", "unitId", "competence")
  WHERE "status" = 'DRAFT' AND "deletedAt" IS NULL;
CREATE INDEX "UsinaMonthlyCostConfig_context_competence_idx"
  ON "UsinaMonthlyCostConfig"("companyId", "unitId", "competence");
CREATE INDEX "UsinaMonthlyCostConfig_status_isCurrent_idx" ON "UsinaMonthlyCostConfig"("status", "isCurrent");
CREATE INDEX "UsinaMonthlyCostConfig_deletedAt_idx" ON "UsinaMonthlyCostConfig"("deletedAt");

CREATE UNIQUE INDEX "UsinaMonthlyCostEquipment_unique_fleet_key"
  ON "UsinaMonthlyCostEquipment"("configId", LOWER(BTRIM("fleetNumber")))
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "UsinaMonthlyCostEquipment_unique_aethos_key"
  ON "UsinaMonthlyCostEquipment"("configId", "aethosVehicleId")
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "UsinaMonthlyCostEquipment_one_support_vehicle_key"
  ON "UsinaMonthlyCostEquipment"("configId")
  WHERE "equipmentType" = 'VEICULO_USINA' AND "deletedAt" IS NULL;
CREATE INDEX "UsinaMonthlyCostEquipment_config_order_idx" ON "UsinaMonthlyCostEquipment"("configId", "sortOrder");
CREATE INDEX "UsinaMonthlyCostEquipment_aethos_idx" ON "UsinaMonthlyCostEquipment"("aethosVehicleId");
CREATE INDEX "UsinaMonthlyCostEquipment_deletedAt_idx" ON "UsinaMonthlyCostEquipment"("deletedAt");
CREATE INDEX "UsinaMonthlyCostAudit_config_created_idx" ON "UsinaMonthlyCostAudit"("configId", "createdAt");
CREATE INDEX "UsinaMonthlyCostAudit_actor_idx" ON "UsinaMonthlyCostAudit"("actorId");

CREATE OR REPLACE FUNCTION public.validate_usina_monthly_cost_config()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_id TEXT;
  target_status TEXT;
  loader_count INTEGER;
  support_count INTEGER;
BEGIN
  target_id := COALESCE(
    to_jsonb(NEW) ->> 'configId',
    to_jsonb(OLD) ->> 'configId',
    to_jsonb(NEW) ->> 'id',
    to_jsonb(OLD) ->> 'id'
  );
  SELECT "status" INTO target_status FROM "UsinaMonthlyCostConfig" WHERE "id" = target_id AND "deletedAt" IS NULL;
  IF target_status = 'CONFIRMED' THEN
    SELECT
      COUNT(*) FILTER (WHERE "equipmentType" = 'CARREGADEIRA'),
      COUNT(*) FILTER (WHERE "equipmentType" = 'VEICULO_USINA')
    INTO loader_count, support_count
    FROM "UsinaMonthlyCostEquipment"
    WHERE "configId" = target_id AND "deletedAt" IS NULL;
    IF loader_count < 1 OR support_count <> 1 THEN
      RAISE EXCEPTION 'Configuracao confirmada exige ao menos uma carregadeira e exatamente um veiculo da Usina';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "UsinaMonthlyCostConfig_integrity_trigger"
AFTER INSERT OR UPDATE ON "UsinaMonthlyCostConfig"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.validate_usina_monthly_cost_config();

CREATE CONSTRAINT TRIGGER "UsinaMonthlyCostEquipment_integrity_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "UsinaMonthlyCostEquipment"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.validate_usina_monthly_cost_config();

CREATE OR REPLACE FUNCTION public.protect_confirmed_usina_monthly_cost_config()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Configuracoes da Usina usam exclusao logica';
  END IF;
  IF OLD."status" = 'CONFIRMED' AND (
    NEW."companyId" IS DISTINCT FROM OLD."companyId" OR
    NEW."unitId" IS DISTINCT FROM OLD."unitId" OR
    NEW."competence" IS DISTINCT FROM OLD."competence" OR
    NEW."version" IS DISTINCT FROM OLD."version" OR
    NEW."status" IS DISTINCT FROM OLD."status" OR
    NEW."taxRate" IS DISTINCT FROM OLD."taxRate" OR
    NEW."observation" IS DISTINCT FROM OLD."observation" OR
    NEW."changeReason" IS DISTINCT FROM OLD."changeReason" OR
    NEW."createdById" IS DISTINCT FROM OLD."createdById" OR
    NEW."confirmedById" IS DISTINCT FROM OLD."confirmedById" OR
    NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt"
  ) THEN
    RAISE EXCEPTION 'Uma configuracao confirmada nao pode ser sobrescrita; crie uma nova versao';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UsinaMonthlyCostConfig_immutable_confirmed_trigger"
BEFORE UPDATE OR DELETE ON "UsinaMonthlyCostConfig"
FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_usina_monthly_cost_config();

CREATE OR REPLACE FUNCTION public.protect_confirmed_usina_monthly_cost_equipment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE parent_status TEXT;
BEGIN
  SELECT "status" INTO parent_status FROM "UsinaMonthlyCostConfig" WHERE "id" = COALESCE(NEW."configId", OLD."configId");
  IF parent_status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Equipamentos de uma configuracao confirmada sao imutaveis; crie uma nova versao';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "UsinaMonthlyCostEquipment_immutable_confirmed_trigger"
BEFORE UPDATE OR DELETE ON "UsinaMonthlyCostEquipment"
FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_usina_monthly_cost_equipment();

DO $$
DECLARE
  seed_actor_id TEXT;
  target_competence DATE;
  config_id TEXT;
  matched_vehicles INTEGER;
BEGIN
  SELECT "id" INTO seed_actor_id
  FROM "User"
  WHERE "active" = TRUE AND LOWER(BTRIM("role")) IN ('admin', 'administrador')
  ORDER BY "createdAt", "id"
  LIMIT 1;

  IF seed_actor_id IS NULL THEN
    RAISE EXCEPTION 'Carga inicial exige um Administrador ativo existente';
  END IF;

  SELECT COUNT(*) INTO matched_vehicles
  FROM (VALUES ('5', '38'), ('60', '208'), ('114', '486')) AS expected(fleet, aethos_id)
  JOIN "Vehicle" vehicle
    ON BTRIM(vehicle."fleet") = expected.fleet
   AND vehicle."aethos_vehicle_id" = expected.aethos_id
   AND vehicle."active" = TRUE;

  IF matched_vehicles <> 3 THEN
    RAISE EXCEPTION 'Carga inicial exige os veiculos Aethos ativos 38/frota 5, 208/frota 60 e 486/frota 114';
  END IF;

  FOR target_competence IN
    SELECT generate_series(DATE '2026-01-01', DATE '2026-08-01', INTERVAL '1 month')::date
  LOOP
    config_id := md5('usina-monthly-cost|' || target_competence::text || '|1');
    INSERT INTO "UsinaMonthlyCostConfig" (
      "id", "companyId", "unitId", "competence", "version", "status", "isCurrent",
      "taxRate", "observation", "createdById", "updatedById", "confirmedById", "confirmedAt"
    ) VALUES (
      config_id, 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', target_competence, 1,
      'CONFIRMED', TRUE, 0.077300, 'Carga inicial conforme parametros operacionais de janeiro a agosto de 2026',
      seed_actor_id, seed_actor_id, seed_actor_id, CURRENT_TIMESTAMP
    ) ON CONFLICT ("companyId", "unitId", "competence", "version") DO NOTHING;

    INSERT INTO "UsinaMonthlyCostEquipment" (
      "id", "configId", "equipmentType", "fleetNumber", "aethosVehicleId", "sortOrder", "createdById", "updatedById"
    ) VALUES
      (md5(config_id || '|loader|38'), config_id, 'CARREGADEIRA', '5', 38, 1, seed_actor_id, seed_actor_id),
      (md5(config_id || '|loader|208'), config_id, 'CARREGADEIRA', '60', 208, 2, seed_actor_id, seed_actor_id),
      (md5(config_id || '|support|486'), config_id, 'VEICULO_USINA', '114', 486, 3, seed_actor_id, seed_actor_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO "UsinaMonthlyCostAudit" ("id", "configId", "action", "note", "snapshot", "actorId")
    VALUES (
      md5(config_id || '|audit|initial'), config_id, 'INITIAL_LOAD',
      'Carga inicial confirmada para os calculos da Usina em 2026',
      jsonb_build_object(
        'competence', target_competence,
        'version', 1,
        'status', 'CONFIRMED',
        'loaders', jsonb_build_array(
          jsonb_build_object('fleetNumber', '5', 'aethosVehicleId', 38),
          jsonb_build_object('fleetNumber', '60', 'aethosVehicleId', 208)
        ),
        'supportVehicle', jsonb_build_object('fleetNumber', '114', 'aethosVehicleId', 486),
        'taxRate', 0.0773
      ),
      seed_actor_id
    ) ON CONFLICT ("id") DO NOTHING;
  END LOOP;
END $$;

CREATE SCHEMA IF NOT EXISTS "bi";

CREATE OR REPLACE VIEW "bi"."usina_parametro_custo_mensal" AS
SELECT
  config."competence" AS competencia,
  equipment."equipmentType" AS tipo_parametro,
  equipment."sortOrder" AS ordem,
  equipment."fleetNumber" AS numero_frota,
  equipment."aethosVehicleId" AS id_veiculo_aethos,
  NULL::NUMERIC(10,6) AS aliquota_decimal,
  NULL::NUMERIC(12,6) AS aliquota_percentual,
  config."observation" AS observacao,
  config."version" AS versao,
  config."confirmedAt" AS confirmado_em,
  COALESCE(confirmed_user."name", confirmed_user."email") AS confirmado_por
FROM "UsinaMonthlyCostConfig" config
JOIN "UsinaMonthlyCostEquipment" equipment ON equipment."configId" = config."id"
LEFT JOIN "User" confirmed_user ON confirmed_user."id" = config."confirmedById"
WHERE config."status" = 'CONFIRMED'
  AND config."isCurrent" = TRUE
  AND config."deletedAt" IS NULL
  AND equipment."deletedAt" IS NULL
UNION ALL
SELECT
  config."competence" AS competencia,
  'IMPOSTO_VENDA'::TEXT AS tipo_parametro,
  COALESCE((
    SELECT MAX(equipment."sortOrder") + 1
    FROM "UsinaMonthlyCostEquipment" equipment
    WHERE equipment."configId" = config."id" AND equipment."deletedAt" IS NULL
  ), 1) AS ordem,
  NULL::TEXT AS numero_frota,
  NULL::INTEGER AS id_veiculo_aethos,
  config."taxRate" AS aliquota_decimal,
  (config."taxRate" * 100)::NUMERIC(12,6) AS aliquota_percentual,
  config."observation" AS observacao,
  config."version" AS versao,
  config."confirmedAt" AS confirmado_em,
  COALESCE(confirmed_user."name", confirmed_user."email") AS confirmado_por
FROM "UsinaMonthlyCostConfig" config
LEFT JOIN "User" confirmed_user ON confirmed_user."id" = config."confirmedById"
WHERE config."status" = 'CONFIRMED'
  AND config."isCurrent" = TRUE
  AND config."deletedAt" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    GRANT USAGE ON SCHEMA bi TO powerbi_reader;
    GRANT SELECT ON bi.usina_parametro_custo_mensal TO powerbi_reader;
  END IF;
END $$;

COMMIT;
