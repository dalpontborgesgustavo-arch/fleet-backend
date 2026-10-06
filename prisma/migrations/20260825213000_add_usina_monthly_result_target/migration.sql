BEGIN;

CREATE TABLE "UsinaMonthlyResultTarget" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "competence" DATE NOT NULL,
  "targetRate" DECIMAL(10,6),
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
  CONSTRAINT "UsinaMonthlyResultTarget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMonthlyResultTarget_competence_first_day" CHECK (EXTRACT(DAY FROM "competence") = 1),
  CONSTRAINT "UsinaMonthlyResultTarget_rate_valid" CHECK ("targetRate" IS NULL OR ("targetRate" >= 0 AND "targetRate" <= 1)),
  CONSTRAINT "UsinaMonthlyResultTarget_status_valid" CHECK ("status" IN ('DRAFT', 'CONFIRMED')),
  CONSTRAINT "UsinaMonthlyResultTarget_version_positive" CHECK ("version" > 0),
  CONSTRAINT "UsinaMonthlyResultTarget_current_confirmed" CHECK (NOT "isCurrent" OR "status" = 'CONFIRMED'),
  CONSTRAINT "UsinaMonthlyResultTarget_confirmed_audit" CHECK (
    "status" <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL)
  ),
  CONSTRAINT "UsinaMonthlyResultTarget_change_reason" CHECK (
    "version" = 1 OR LENGTH(BTRIM(COALESCE("changeReason", ''))) > 0
  ),
  CONSTRAINT "UsinaMonthlyResultTarget_deleted_not_current" CHECK ("deletedAt" IS NULL OR NOT "isCurrent"),
  CONSTRAINT "UsinaMonthlyResultTarget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyResultTarget_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyResultTarget_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyResultTarget_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "UsinaMonthlyResultTargetAudit" (
  "id" TEXT NOT NULL,
  "resultTargetId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "snapshot" JSONB,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaMonthlyResultTargetAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaMonthlyResultTargetAudit_resultTargetId_fkey" FOREIGN KEY ("resultTargetId") REFERENCES "UsinaMonthlyResultTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaMonthlyResultTargetAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UsinaMonthlyResultTarget_context_competence_version_key"
  ON "UsinaMonthlyResultTarget"("companyId", "unitId", "competence", "version");
CREATE UNIQUE INDEX "UsinaMonthlyResultTarget_one_current_key"
  ON "UsinaMonthlyResultTarget"("companyId", "unitId", "competence")
  WHERE "isCurrent" = TRUE AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "UsinaMonthlyResultTarget_one_draft_key"
  ON "UsinaMonthlyResultTarget"("companyId", "unitId", "competence")
  WHERE "status" = 'DRAFT' AND "deletedAt" IS NULL;
CREATE INDEX "UsinaMonthlyResultTarget_context_competence_idx"
  ON "UsinaMonthlyResultTarget"("companyId", "unitId", "competence");
CREATE INDEX "UsinaMonthlyResultTarget_status_isCurrent_idx"
  ON "UsinaMonthlyResultTarget"("status", "isCurrent");
CREATE INDEX "UsinaMonthlyResultTarget_deletedAt_idx"
  ON "UsinaMonthlyResultTarget"("deletedAt");
CREATE INDEX "UsinaMonthlyResultTargetAudit_target_created_idx"
  ON "UsinaMonthlyResultTargetAudit"("resultTargetId", "createdAt");
CREATE INDEX "UsinaMonthlyResultTargetAudit_actor_idx"
  ON "UsinaMonthlyResultTargetAudit"("actorId");

CREATE OR REPLACE FUNCTION public.protect_confirmed_usina_monthly_result_target()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Metas mensais de resultado usam exclusao logica';
  END IF;
  IF OLD."status" = 'CONFIRMED' AND (
    NEW."companyId" IS DISTINCT FROM OLD."companyId" OR
    NEW."unitId" IS DISTINCT FROM OLD."unitId" OR
    NEW."competence" IS DISTINCT FROM OLD."competence" OR
    NEW."targetRate" IS DISTINCT FROM OLD."targetRate" OR
    NEW."observation" IS DISTINCT FROM OLD."observation" OR
    NEW."status" IS DISTINCT FROM OLD."status" OR
    NEW."version" IS DISTINCT FROM OLD."version" OR
    NEW."changeReason" IS DISTINCT FROM OLD."changeReason" OR
    NEW."createdById" IS DISTINCT FROM OLD."createdById" OR
    NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt" OR
    NEW."confirmedById" IS DISTINCT FROM OLD."confirmedById"
  ) THEN
    RAISE EXCEPTION 'Uma meta confirmada nao pode ser sobrescrita; crie uma nova versao';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UsinaMonthlyResultTarget_immutable_confirmed_trigger"
BEFORE UPDATE OR DELETE ON "UsinaMonthlyResultTarget"
FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_usina_monthly_result_target();

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
    RAISE EXCEPTION 'Carga inicial da meta de resultado exige um Administrador ativo existente';
  END IF;

  FOR target_competence IN
    SELECT generate_series(DATE '2025-01-01', DATE '2026-12-01', INTERVAL '1 month')::date
  LOOP
    INSERT INTO "UsinaMonthlyResultTarget" (
      "id", "companyId", "unitId", "competence", "targetRate", "observation",
      "status", "version", "isCurrent", "createdAt", "createdById", "updatedAt", "updatedById",
      "confirmedAt", "confirmedById"
    ) VALUES (
      md5('usina-monthly-result-target|' || target_competence::text || '|1'),
      'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', target_competence, 0.111000,
      'Carga inicial da premissa validada do relatório da Usina',
      'CONFIRMED', 1, TRUE, CURRENT_TIMESTAMP, seed_actor_id, CURRENT_TIMESTAMP, seed_actor_id,
      CURRENT_TIMESTAMP, seed_actor_id
    ) ON CONFLICT ("companyId", "unitId", "competence", "version") DO NOTHING;

    SELECT "id" INTO target_id
    FROM "UsinaMonthlyResultTarget"
    WHERE "companyId" = 'JR_CONSTRUCOES'
      AND "unitId" = 'USINA_ASFALTO_ICARA'
      AND "competence" = target_competence
      AND "version" = 1;

    INSERT INTO "UsinaMonthlyResultTargetAudit" (
      "id", "resultTargetId", "action", "note", "snapshot", "actorId"
    ) VALUES (
      md5(target_id || '|audit|initial'), target_id, 'INITIAL_LOAD',
      'Carga inicial da premissa validada do relatório da Usina',
      jsonb_build_object(
        'competence', target_competence,
        'targetRate', '0.111000',
        'targetPercent', '11.10',
        'status', 'CONFIRMED',
        'version', 1
      ),
      seed_actor_id
    ) ON CONFLICT ("id") DO NOTHING;
  END LOOP;
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
  AND depreciation."deletedAt" IS NULL
UNION ALL
SELECT
  target."competence" AS competencia,
  'PERCENTUAL_RESULTADO_PREVISTO'::TEXT AS tipo_parametro,
  5 AS ordem,
  NULL::TEXT AS numero_frota,
  NULL::INTEGER AS id_veiculo_aethos,
  target."targetRate" AS aliquota_decimal,
  (CASE WHEN target."targetRate" IS NULL THEN NULL
        ELSE target."targetRate" * 100
   END)::NUMERIC(12,6) AS aliquota_percentual,
  target."observation" AS observacao,
  target."version" AS versao,
  target."confirmedAt" AS confirmado_em,
  COALESCE(confirmed_user."name", confirmed_user."email") AS confirmado_por,
  NULL::NUMERIC(18,2) AS valor_anual,
  NULL::NUMERIC(18,2) AS valor_mensal
FROM "UsinaMonthlyResultTarget" target
LEFT JOIN "User" confirmed_user ON confirmed_user."id" = target."confirmedById"
WHERE target."status" = 'CONFIRMED'
  AND target."isCurrent" = TRUE
  AND target."deletedAt" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    GRANT USAGE ON SCHEMA bi TO powerbi_reader;
    GRANT SELECT ON bi.usina_parametro_custo_mensal TO powerbi_reader;
  END IF;
END $$;

COMMIT;
