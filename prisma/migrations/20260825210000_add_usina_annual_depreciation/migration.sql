BEGIN;

CREATE TABLE "UsinaAnnualDepreciation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "exercise" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "annualValue" DECIMAL(18,2) NOT NULL,
  "monthlyValue" DECIMAL(18,2) NOT NULL,
  "observation" TEXT,
  "status" TEXT NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT FALSE,
  "changeReason" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "confirmedById" TEXT,
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "UsinaAnnualDepreciation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaAnnualDepreciation_exercise_valid" CHECK ("exercise" BETWEEN 2025 AND 2100),
  CONSTRAINT "UsinaAnnualDepreciation_version_positive" CHECK ("version" > 0),
  CONSTRAINT "UsinaAnnualDepreciation_values_non_negative" CHECK (
    "annualValue" >= 0 AND "monthlyValue" >= 0
  ),
  CONSTRAINT "UsinaAnnualDepreciation_monthly_calculation" CHECK (
    "monthlyValue" = ROUND("annualValue" / 12, 2)
  ),
  CONSTRAINT "UsinaAnnualDepreciation_status_valid" CHECK ("status" IN ('DRAFT', 'CONFIRMED')),
  CONSTRAINT "UsinaAnnualDepreciation_current_confirmed" CHECK (NOT "isCurrent" OR "status" = 'CONFIRMED'),
  CONSTRAINT "UsinaAnnualDepreciation_confirmed_audit" CHECK (
    "status" <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL)
  ),
  CONSTRAINT "UsinaAnnualDepreciation_change_reason" CHECK (
    "version" = 1 OR LENGTH(BTRIM(COALESCE("changeReason", ''))) > 0
  ),
  CONSTRAINT "UsinaAnnualDepreciation_deleted_not_current" CHECK ("deletedAt" IS NULL OR NOT "isCurrent"),
  CONSTRAINT "UsinaAnnualDepreciation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaAnnualDepreciation_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaAnnualDepreciation_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaAnnualDepreciation_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "UsinaAnnualDepreciationAudit" (
  "id" TEXT NOT NULL,
  "depreciationId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "snapshot" JSONB,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaAnnualDepreciationAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaAnnualDepreciationAudit_depreciationId_fkey" FOREIGN KEY ("depreciationId") REFERENCES "UsinaAnnualDepreciation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaAnnualDepreciationAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UsinaAnnualDepreciation_context_exercise_version_key"
  ON "UsinaAnnualDepreciation"("companyId", "unitId", "exercise", "version");
CREATE UNIQUE INDEX "UsinaAnnualDepreciation_one_current_key"
  ON "UsinaAnnualDepreciation"("companyId", "unitId", "exercise")
  WHERE "isCurrent" = TRUE AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "UsinaAnnualDepreciation_one_draft_key"
  ON "UsinaAnnualDepreciation"("companyId", "unitId", "exercise")
  WHERE "status" = 'DRAFT' AND "deletedAt" IS NULL;
CREATE INDEX "UsinaAnnualDepreciation_context_exercise_idx"
  ON "UsinaAnnualDepreciation"("companyId", "unitId", "exercise");
CREATE INDEX "UsinaAnnualDepreciation_status_isCurrent_idx"
  ON "UsinaAnnualDepreciation"("status", "isCurrent");
CREATE INDEX "UsinaAnnualDepreciation_deletedAt_idx"
  ON "UsinaAnnualDepreciation"("deletedAt");
CREATE INDEX "UsinaAnnualDepreciationAudit_depreciation_created_idx"
  ON "UsinaAnnualDepreciationAudit"("depreciationId", "createdAt");
CREATE INDEX "UsinaAnnualDepreciationAudit_actor_idx"
  ON "UsinaAnnualDepreciationAudit"("actorId");

CREATE OR REPLACE FUNCTION public.protect_confirmed_usina_annual_depreciation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Depreciacoes da Usina usam exclusao logica';
  END IF;
  IF OLD."status" = 'CONFIRMED' AND (
    NEW."companyId" IS DISTINCT FROM OLD."companyId" OR
    NEW."unitId" IS DISTINCT FROM OLD."unitId" OR
    NEW."exercise" IS DISTINCT FROM OLD."exercise" OR
    NEW."version" IS DISTINCT FROM OLD."version" OR
    NEW."annualValue" IS DISTINCT FROM OLD."annualValue" OR
    NEW."monthlyValue" IS DISTINCT FROM OLD."monthlyValue" OR
    NEW."observation" IS DISTINCT FROM OLD."observation" OR
    NEW."status" IS DISTINCT FROM OLD."status" OR
    NEW."changeReason" IS DISTINCT FROM OLD."changeReason" OR
    NEW."createdById" IS DISTINCT FROM OLD."createdById" OR
    NEW."confirmedById" IS DISTINCT FROM OLD."confirmedById" OR
    NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt"
  ) THEN
    RAISE EXCEPTION 'Uma depreciacao confirmada nao pode ser sobrescrita; crie uma nova versao';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UsinaAnnualDepreciation_immutable_confirmed_trigger"
BEFORE UPDATE OR DELETE ON "UsinaAnnualDepreciation"
FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_usina_annual_depreciation();

DO $$
DECLARE
  seed_actor_id TEXT;
  depreciation_id TEXT := md5('usina-annual-depreciation|2026|1');
BEGIN
  SELECT "id" INTO seed_actor_id
  FROM "User"
  WHERE "active" = TRUE AND LOWER(BTRIM("role")) IN ('admin', 'administrador')
  ORDER BY "createdAt", "id"
  LIMIT 1;

  IF seed_actor_id IS NULL THEN
    RAISE EXCEPTION 'Carga inicial da depreciacao exige um Administrador ativo existente';
  END IF;

  INSERT INTO "UsinaAnnualDepreciation" (
    "id", "companyId", "unitId", "exercise", "version", "annualValue", "monthlyValue",
    "observation", "status", "isCurrent", "createdById", "updatedById", "confirmedById", "confirmedAt"
  ) VALUES (
    depreciation_id, 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 2026, 1, 90024.00, 7502.00,
    'Carga inicial da depreciacao anual da Usina para o exercicio de 2026',
    'CONFIRMED', TRUE, seed_actor_id, seed_actor_id, seed_actor_id, CURRENT_TIMESTAMP
  ) ON CONFLICT ("companyId", "unitId", "exercise", "version") DO NOTHING;

  INSERT INTO "UsinaAnnualDepreciationAudit" (
    "id", "depreciationId", "action", "note", "snapshot", "actorId"
  ) VALUES (
    md5(depreciation_id || '|audit|initial'), depreciation_id, 'INITIAL_LOAD',
    'Carga inicial confirmada para os calculos de custos da Usina em 2026',
    jsonb_build_object(
      'exercise', 2026,
      'version', 1,
      'status', 'CONFIRMED',
      'annualValue', 90024.00,
      'monthlyValue', 7502.00
    ),
    seed_actor_id
  ) ON CONFLICT ("id") DO NOTHING;
END $$;

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
  COALESCE(confirmed_user."name", confirmed_user."email") AS confirmado_por,
  NULL::NUMERIC(18,2) AS valor_anual,
  NULL::NUMERIC(18,2) AS valor_mensal
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
  COALESCE(confirmed_user."name", confirmed_user."email") AS confirmado_por,
  NULL::NUMERIC(18,2) AS valor_anual,
  NULL::NUMERIC(18,2) AS valor_mensal
FROM "UsinaMonthlyCostConfig" config
LEFT JOIN "User" confirmed_user ON confirmed_user."id" = config."confirmedById"
WHERE config."status" = 'CONFIRMED'
  AND config."isCurrent" = TRUE
  AND config."deletedAt" IS NULL
UNION ALL
SELECT
  (make_date(depreciation."exercise", 1, 1) + (month_index.value || ' months')::INTERVAL)::DATE AS competencia,
  'DEPRECIACAO_USINA'::TEXT AS tipo_parametro,
  1 AS ordem,
  NULL::TEXT AS numero_frota,
  NULL::INTEGER AS id_veiculo_aethos,
  NULL::NUMERIC(10,6) AS aliquota_decimal,
  NULL::NUMERIC(12,6) AS aliquota_percentual,
  depreciation."observation" AS observacao,
  depreciation."version" AS versao,
  depreciation."confirmedAt" AS confirmado_em,
  COALESCE(confirmed_user."name", confirmed_user."email") AS confirmado_por,
  depreciation."annualValue" AS valor_anual,
  depreciation."monthlyValue" AS valor_mensal
FROM "UsinaAnnualDepreciation" depreciation
CROSS JOIN generate_series(0, 11) AS month_index(value)
LEFT JOIN "User" confirmed_user ON confirmed_user."id" = depreciation."confirmedById"
WHERE depreciation."status" = 'CONFIRMED'
  AND depreciation."isCurrent" = TRUE
  AND depreciation."deletedAt" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    GRANT USAGE ON SCHEMA bi TO powerbi_reader;
    GRANT SELECT ON bi.usina_parametro_custo_mensal TO powerbi_reader;
  END IF;
END $$;

COMMIT;
