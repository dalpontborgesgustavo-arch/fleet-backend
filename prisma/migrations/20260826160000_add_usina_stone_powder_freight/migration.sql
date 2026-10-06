BEGIN;

CREATE TABLE "UsinaMonthlyStonePowderFreight" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "competence" DATE NOT NULL,
  "unitCostPerM3" DECIMAL(14,6) NOT NULL,
  "observation" TEXT,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT FALSE,
  "changeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmedById" TEXT,
  "deletedAt" TIMESTAMP(3),
  "deletedById" TEXT,
  CONSTRAINT "UsinaMonthlyStonePowderFreight_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMonthlyStonePowderFreight_competence_first_day" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "UsinaMonthlyStonePowderFreight_value_valid" CHECK ("unitCostPerM3" >= 0),
  CONSTRAINT "UsinaMonthlyStonePowderFreight_status_valid" CHECK ("status" IN ('DRAFT', 'CONFIRMED')),
  CONSTRAINT "UsinaMonthlyStonePowderFreight_version_positive" CHECK ("version" > 0),
  CONSTRAINT "UsinaMonthlyStonePowderFreight_current_confirmed" CHECK (NOT "isCurrent" OR "status" = 'CONFIRMED'),
  CONSTRAINT "UsinaMonthlyStonePowderFreight_confirmed_audit" CHECK (
    "status" <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL)
  ),
  CONSTRAINT "UsinaMonthlyStonePowderFreight_change_reason" CHECK (
    "version" = 1 OR LENGTH(BTRIM(COALESCE("changeReason", ''))) > 0
  ),
  CONSTRAINT "UsinaMonthlyStonePowderFreight_deleted_not_current" CHECK ("deletedAt" IS NULL OR NOT "isCurrent"),
  CONSTRAINT "UsinaMonthlyStonePowderFreight_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyStonePowderFreight_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyStonePowderFreight_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyStonePowderFreight_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

COMMENT ON COLUMN "UsinaMonthlyStonePowderFreight"."unitCostPerM3" IS
  'Frete unitario da rota Pedraforte para a Usina, em BRL por metro cubico';

CREATE TABLE "UsinaMonthlyStonePowderFreightAudit" (
  "id" TEXT NOT NULL,
  "freightConfigId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "snapshot" JSONB,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaMonthlyStonePowderFreightAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMonthlyStonePowderFreightAudit_freightConfigId_fkey" FOREIGN KEY ("freightConfigId") REFERENCES "UsinaMonthlyStonePowderFreight"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyStonePowderFreightAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UsinaMonthlyStonePowderFreight_context_competence_version_key"
  ON "UsinaMonthlyStonePowderFreight"("companyId", "unitId", "competence", "version");
CREATE UNIQUE INDEX "UsinaMonthlyStonePowderFreight_one_current_key"
  ON "UsinaMonthlyStonePowderFreight"("companyId", "unitId", "competence")
  WHERE "isCurrent" = TRUE AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "UsinaMonthlyStonePowderFreight_one_draft_key"
  ON "UsinaMonthlyStonePowderFreight"("companyId", "unitId", "competence")
  WHERE "status" = 'DRAFT' AND "deletedAt" IS NULL;
CREATE INDEX "UsinaMonthlyStonePowderFreight_context_competence_idx"
  ON "UsinaMonthlyStonePowderFreight"("companyId", "unitId", "competence");
CREATE INDEX "UsinaMonthlyStonePowderFreight_status_isCurrent_idx"
  ON "UsinaMonthlyStonePowderFreight"("status", "isCurrent");
CREATE INDEX "UsinaMonthlyStonePowderFreight_deletedAt_idx"
  ON "UsinaMonthlyStonePowderFreight"("deletedAt");
CREATE INDEX "UsinaMonthlyStonePowderFreightAudit_target_created_idx"
  ON "UsinaMonthlyStonePowderFreightAudit"("freightConfigId", "createdAt");
CREATE INDEX "UsinaMonthlyStonePowderFreightAudit_actor_idx"
  ON "UsinaMonthlyStonePowderFreightAudit"("actorId");

CREATE OR REPLACE FUNCTION public.protect_confirmed_usina_monthly_stone_powder_freight()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Fretes mensais do po de pedra usam exclusao logica';
  END IF;
  IF OLD."status" = 'CONFIRMED' AND (
    NEW."companyId" IS DISTINCT FROM OLD."companyId" OR
    NEW."unitId" IS DISTINCT FROM OLD."unitId" OR
    NEW."competence" IS DISTINCT FROM OLD."competence" OR
    NEW."unitCostPerM3" IS DISTINCT FROM OLD."unitCostPerM3" OR
    NEW."observation" IS DISTINCT FROM OLD."observation" OR
    NEW."status" IS DISTINCT FROM OLD."status" OR
    NEW."version" IS DISTINCT FROM OLD."version" OR
    NEW."changeReason" IS DISTINCT FROM OLD."changeReason" OR
    NEW."createdById" IS DISTINCT FROM OLD."createdById" OR
    NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt" OR
    NEW."confirmedById" IS DISTINCT FROM OLD."confirmedById"
  ) THEN
    RAISE EXCEPTION 'Um frete confirmado nao pode ser sobrescrito; crie uma nova versao';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UsinaMonthlyStonePowderFreight_immutable_confirmed_trigger"
BEFORE UPDATE OR DELETE ON "UsinaMonthlyStonePowderFreight"
FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_usina_monthly_stone_powder_freight();

DO $$
DECLARE
  seed_actor_id TEXT;
  target_competence DATE;
  target_id TEXT;
BEGIN
  SELECT "id" INTO seed_actor_id
  FROM "User"
  WHERE "active" = TRUE AND LOWER(BTRIM("role")) IN ('admin', 'administrador')
  ORDER BY "createdAt", "id"
  LIMIT 1;

  IF seed_actor_id IS NULL THEN
    RAISE EXCEPTION 'Carga inicial do frete do po de pedra exige um Administrador ativo existente';
  END IF;

  FOR target_competence IN
    SELECT generate_series(DATE '2025-01-01', DATE '2026-08-01', INTERVAL '1 month')::date
  LOOP
    INSERT INTO "UsinaMonthlyStonePowderFreight" (
      "id", "companyId", "unitId", "competence", "unitCostPerM3", "observation",
      "status", "version", "isCurrent", "createdAt", "createdById", "updatedAt", "updatedById",
      "confirmedAt", "confirmedById"
    ) VALUES (
      md5('usina-monthly-stone-powder-freight|' || target_competence::text || '|1'),
      'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', target_competence, 27.560000,
      'Carga inicial do frete unitario da rota Pedraforte para a Usina, conforme decisao operacional de 26/08/2026',
      'CONFIRMED', 1, TRUE, CURRENT_TIMESTAMP, seed_actor_id, CURRENT_TIMESTAMP, seed_actor_id,
      CURRENT_TIMESTAMP, seed_actor_id
    ) ON CONFLICT ("companyId", "unitId", "competence", "version") DO NOTHING;

    SELECT "id" INTO target_id
    FROM "UsinaMonthlyStonePowderFreight"
    WHERE "companyId" = 'JR_CONSTRUCOES'
      AND "unitId" = 'USINA_ASFALTO_ICARA'
      AND "competence" = target_competence
      AND "version" = 1;

    INSERT INTO "UsinaMonthlyStonePowderFreightAudit" (
      "id", "freightConfigId", "action", "note", "snapshot", "actorId"
    ) VALUES (
      md5(target_id || '|audit|initial'), target_id, 'INITIAL_LOAD',
      'Carga inicial solicitada: janeiro/2025 a agosto/2026 por R$ 27,56/m3',
      jsonb_build_object(
        'competence', target_competence,
        'unitCostPerM3', '27.560000',
        'status', 'CONFIRMED',
        'version', 1
      ),
      seed_actor_id
    ) ON CONFLICT ("id") DO NOTHING;
  END LOOP;
END $$;

COMMIT;
