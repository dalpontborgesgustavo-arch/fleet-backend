ALTER TABLE "Checklist"
  ADD COLUMN "monthly_responsible_user_id" TEXT,
  ADD COLUMN "monthly_responsible_name" TEXT,
  ADD COLUMN "assisted_execution" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Checklist"
  ADD CONSTRAINT "Checklist_monthly_responsible_user_id_fkey"
  FOREIGN KEY ("monthly_responsible_user_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Checklist" checklist
SET
  "monthly_responsible_user_id" = vehicle."monthly_checklist_responsible_id",
  "monthly_responsible_name" = responsible."name",
  "assisted_execution" = (
    vehicle."monthly_checklist_responsible_id" IS NOT NULL
    AND vehicle."monthly_checklist_responsible_id" <> checklist."createdBy"
  )
FROM "Vehicle" vehicle
LEFT JOIN "User" responsible
  ON responsible."id" = vehicle."monthly_checklist_responsible_id"
WHERE checklist."type"::text = 'MONTHLY'
  AND checklist."vehicleId" = vehicle."id";

CREATE INDEX "Checklist_monthly_responsible_user_id_year_month_idx"
  ON "Checklist" ("monthly_responsible_user_id", "year", "month");

CREATE INDEX "Checklist_assisted_execution_year_month_idx"
  ON "Checklist" ("assisted_execution", "year", "month");

CREATE OR REPLACE VIEW "bi"."checklist_mensal_ajudas" AS
SELECT
  checklist."id" AS checklist_id,
  MAKE_DATE(checklist."year", checklist."month", 1) AS competencia,
  checklist."createdAt" AS realizado_em,
  checklist."vehicleId" AS veiculo_id,
  vehicle."fleet" AS frota,
  vehicle."plate" AS placa,
  vehicle."name" AS veiculo_nome,
  vehicle."tipoFrota" AS tipo_frota,
  checklist."monthly_responsible_user_id" AS responsavel_mensal_id,
  COALESCE(checklist."monthly_responsible_name", responsible."name") AS responsavel_mensal_nome,
  checklist."createdBy" AS executor_id,
  creator."name" AS executor_nome,
  checklist."assisted_execution" AS realizado_por_ajuda
FROM "Checklist" checklist
LEFT JOIN "Vehicle" vehicle ON vehicle."id" = checklist."vehicleId"
LEFT JOIN "User" responsible ON responsible."id" = checklist."monthly_responsible_user_id"
LEFT JOIN "User" creator ON creator."id" = checklist."createdBy"
WHERE checklist."type"::text = 'MONTHLY';

COMMENT ON VIEW "bi"."checklist_mensal_ajudas" IS
  'Checklists mensais com separacao entre responsavel original e executor, incluindo execucoes realizadas por ajuda.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_reader') THEN
    EXECUTE 'GRANT SELECT ON "bi"."checklist_mensal_ajudas" TO powerbi_reader';
  END IF;
END $$;
