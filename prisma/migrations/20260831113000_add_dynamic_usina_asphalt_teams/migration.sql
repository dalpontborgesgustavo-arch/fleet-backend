BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "UsinaAsphaltTeam" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "validFrom" DATE NOT NULL,
  "validTo" DATE,
  "createdById" TEXT,
  "updatedById" TEXT,
  "deletedAt" TIMESTAMPTZ(6),
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaAsphaltTeam_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaAsphaltTeam_validity_check" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom")
);

CREATE TABLE "UsinaAsphaltTeamVersion" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "businessCode" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "responsibleName" TEXT,
  "validFrom" DATE NOT NULL,
  "validTo" DATE,
  "changeReason" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "deletedAt" TIMESTAMPTZ(6),
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaAsphaltTeamVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaAsphaltTeamVersion_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "UsinaAsphaltTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaAsphaltTeamVersion_version_check" CHECK ("version" > 0),
  CONSTRAINT "UsinaAsphaltTeamVersion_code_check" CHECK (LENGTH(BTRIM("businessCode")) BETWEEN 1 AND 30),
  CONSTRAINT "UsinaAsphaltTeamVersion_name_check" CHECK (LENGTH(BTRIM("displayName")) BETWEEN 1 AND 120),
  CONSTRAINT "UsinaAsphaltTeamVersion_validity_check" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom")
);

CREATE TABLE "UsinaAsphaltTeamItemAssignment" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "aethosProductId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "validFrom" DATE NOT NULL,
  "validTo" DATE,
  "changeReason" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "deletedAt" TIMESTAMPTZ(6),
  "deletedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaAsphaltTeamItemAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaAsphaltTeamItemAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "UsinaAsphaltTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsinaAsphaltTeamItemAssignment_product_check" CHECK ("aethosProductId" > 0),
  CONSTRAINT "UsinaAsphaltTeamItemAssignment_version_check" CHECK ("version" > 0),
  CONSTRAINT "UsinaAsphaltTeamItemAssignment_validity_check" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom")
);

CREATE TABLE "UsinaAsphaltTeamAudit" (
  "id" TEXT NOT NULL,
  "teamId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "before" JSONB,
  "after" JSONB,
  "actorId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsinaAsphaltTeamAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsinaAsphaltTeamAudit_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "UsinaAsphaltTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UsinaAsphaltTeamVersion_teamId_version_key" ON "UsinaAsphaltTeamVersion"("teamId", "version");
CREATE UNIQUE INDEX "UsinaAsphaltTeamItemAssignment_context_product_version_key" ON "UsinaAsphaltTeamItemAssignment"("companyId", "unitId", "aethosProductId", "version");
CREATE INDEX "UsinaAsphaltTeam_context_validity_idx" ON "UsinaAsphaltTeam"("companyId", "unitId", "validFrom", "validTo");
CREATE INDEX "UsinaAsphaltTeam_deletedAt_idx" ON "UsinaAsphaltTeam"("deletedAt");
CREATE INDEX "UsinaAsphaltTeamVersion_context_code_validity_idx" ON "UsinaAsphaltTeamVersion"("companyId", "unitId", "businessCode", "validFrom", "validTo");
CREATE INDEX "UsinaAsphaltTeamVersion_team_validity_idx" ON "UsinaAsphaltTeamVersion"("teamId", "validFrom", "validTo");
CREATE INDEX "UsinaAsphaltTeamVersion_deletedAt_idx" ON "UsinaAsphaltTeamVersion"("deletedAt");
CREATE INDEX "UsinaAsphaltTeamItemAssignment_context_product_validity_idx" ON "UsinaAsphaltTeamItemAssignment"("companyId", "unitId", "aethosProductId", "validFrom", "validTo");
CREATE INDEX "UsinaAsphaltTeamItemAssignment_team_validity_idx" ON "UsinaAsphaltTeamItemAssignment"("teamId", "validFrom", "validTo");
CREATE INDEX "UsinaAsphaltTeamItemAssignment_deletedAt_idx" ON "UsinaAsphaltTeamItemAssignment"("deletedAt");
CREATE INDEX "UsinaAsphaltTeamAudit_team_createdAt_idx" ON "UsinaAsphaltTeamAudit"("teamId", "createdAt");
CREATE INDEX "UsinaAsphaltTeamAudit_entity_createdAt_idx" ON "UsinaAsphaltTeamAudit"("entityType", "entityId", "createdAt");
CREATE INDEX "UsinaAsphaltTeamAudit_actorId_idx" ON "UsinaAsphaltTeamAudit"("actorId");

ALTER TABLE "UsinaAsphaltTeamVersion"
  ADD CONSTRAINT "UsinaAsphaltTeamVersion_no_team_overlap"
  EXCLUDE USING gist (
    "teamId" WITH =,
    daterange("validFrom", COALESCE("validTo", 'infinity'::date), '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);

ALTER TABLE "UsinaAsphaltTeamVersion"
  ADD CONSTRAINT "UsinaAsphaltTeamVersion_no_code_overlap"
  EXCLUDE USING gist (
    "companyId" WITH =,
    "unitId" WITH =,
    (LOWER("businessCode")) WITH =,
    daterange("validFrom", COALESCE("validTo", 'infinity'::date), '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);

ALTER TABLE "UsinaAsphaltTeamItemAssignment"
  ADD CONSTRAINT "UsinaAsphaltTeamItemAssignment_no_product_overlap"
  EXCLUDE USING gist (
    "companyId" WITH =,
    "unitId" WITH =,
    "aethosProductId" WITH =,
    daterange("validFrom", COALESCE("validTo", 'infinity'::date), '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);

CREATE OR REPLACE FUNCTION "validate_usina_asphalt_team_child_validity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_team "UsinaAsphaltTeam"%ROWTYPE;
BEGIN
  SELECT * INTO parent_team FROM "UsinaAsphaltTeam" WHERE "id" = NEW."teamId";
  IF NOT FOUND OR parent_team."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Equipe inexistente ou excluida: %', NEW."teamId";
  END IF;
  IF NEW."companyId" <> parent_team."companyId" OR NEW."unitId" <> parent_team."unitId" THEN
    RAISE EXCEPTION 'Contexto do registro diverge da equipe %', NEW."teamId";
  END IF;
  IF NEW."validFrom" < parent_team."validFrom"
     OR (parent_team."validTo" IS NOT NULL AND (NEW."validTo" IS NULL OR NEW."validTo" > parent_team."validTo")) THEN
    RAISE EXCEPTION 'Vigencia do registro deve estar contida na vigencia da equipe %', NEW."teamId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UsinaAsphaltTeamVersion_parent_validity_trigger"
BEFORE INSERT OR UPDATE ON "UsinaAsphaltTeamVersion"
FOR EACH ROW EXECUTE FUNCTION "validate_usina_asphalt_team_child_validity"();

CREATE TRIGGER "UsinaAsphaltTeamItemAssignment_parent_validity_trigger"
BEFORE INSERT OR UPDATE ON "UsinaAsphaltTeamItemAssignment"
FOR EACH ROW EXECUTE FUNCTION "validate_usina_asphalt_team_child_validity"();

INSERT INTO "UsinaAsphaltTeam" ("id", "companyId", "unitId", "validFrom", "createdAt", "updatedAt") VALUES
  ('seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', DATE '2025-01-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-team-02', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', DATE '2025-01-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-team-03', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', DATE '2025-01-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-team-04', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', DATE '2025-01-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-team-05', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', DATE '2025-01-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "UsinaAsphaltTeamVersion" ("id", "teamId", "companyId", "unitId", "version", "businessCode", "displayName", "responsibleName", "validFrom", "validTo", "changeReason", "createdAt", "updatedAt") VALUES
  ('seed-usina-asphalt-team-version-01-1', 'seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 1, '01', 'Silvano', 'Silvano', DATE '2025-01-01', NULL, 'Carga inicial do mapeamento historico de 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-team-version-02-1', 'seed-usina-asphalt-team-02', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 1, '02', 'Gean Andre', 'Gean Andre', DATE '2025-01-01', NULL, 'Carga inicial do mapeamento historico de 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-team-version-03-1', 'seed-usina-asphalt-team-03', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 1, '03', 'Kadmiel', 'Kadmiel', DATE '2025-01-01', NULL, 'Carga inicial do mapeamento historico de 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-team-version-04-1', 'seed-usina-asphalt-team-04', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 1, '04', 'Augusto', 'Augusto', DATE '2025-01-01', DATE '2025-03-31', 'Responsavel historico da equipe 04 ate marco de 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-team-version-04-2', 'seed-usina-asphalt-team-04', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 2, '04', 'Carlos Daniel', 'Carlos Daniel', DATE '2025-04-01', NULL, 'Transicao historica da equipe 04 em abril de 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-team-version-05-1', 'seed-usina-asphalt-team-05', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 1, '05', 'Jose Nunes', 'Jose Nunes', DATE '2025-01-01', NULL, 'Carga inicial do mapeamento historico de 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "UsinaAsphaltTeamItemAssignment" ("id", "teamId", "companyId", "unitId", "aethosProductId", "version", "validFrom", "validTo", "changeReason", "createdAt", "updatedAt") VALUES
  ('seed-usina-asphalt-assignment-5347-1', 'seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 5347, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-5642-1', 'seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 5642, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-7991-1', 'seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 7991, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-12402-1', 'seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 12402, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-13232-1', 'seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 13232, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-13346-1', 'seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 13346, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-13356-1', 'seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 13356, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14704-1', 'seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14704, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14706-1', 'seed-usina-asphalt-team-01', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14706, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-5444-1', 'seed-usina-asphalt-team-02', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 5444, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-7765-1', 'seed-usina-asphalt-team-02', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 7765, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-7993-1', 'seed-usina-asphalt-team-02', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 7993, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-12401-1', 'seed-usina-asphalt-team-02', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 12401, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14713-1', 'seed-usina-asphalt-team-02', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14713, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-10937-1', 'seed-usina-asphalt-team-03', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 10937, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-10938-1', 'seed-usina-asphalt-team-03', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 10938, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-12400-1', 'seed-usina-asphalt-team-03', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 12400, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-13235-1', 'seed-usina-asphalt-team-03', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 13235, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-13355-1', 'seed-usina-asphalt-team-03', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 13355, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-13989-1', 'seed-usina-asphalt-team-03', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 13989, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14703-1', 'seed-usina-asphalt-team-03', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14703, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-13872-1', 'seed-usina-asphalt-team-04', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 13872, 1, DATE '2025-01-01', DATE '2025-03-31', 'Equipe 04 Augusto historico', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14247-1', 'seed-usina-asphalt-team-04', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14247, 1, DATE '2025-04-01', NULL, 'Equipe 04 Carlos Daniel', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14248-1', 'seed-usina-asphalt-team-04', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14248, 1, DATE '2025-04-01', NULL, 'Equipe 04 Carlos Daniel', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14254-1', 'seed-usina-asphalt-team-04', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14254, 1, DATE '2025-04-01', NULL, 'Equipe 04 Carlos Daniel', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14702-1', 'seed-usina-asphalt-team-04', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14702, 1, DATE '2025-04-01', NULL, 'Equipe 04 Carlos Daniel', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14715-1', 'seed-usina-asphalt-team-04', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14715, 1, DATE '2025-04-01', NULL, 'Equipe 04 Carlos Daniel', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14217-1', 'seed-usina-asphalt-team-05', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14217, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14218-1', 'seed-usina-asphalt-team-05', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14218, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14224-1', 'seed-usina-asphalt-team-05', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14224, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14225-1', 'seed-usina-asphalt-team-05', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14225, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14711-1', 'seed-usina-asphalt-team-05', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14711, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-usina-asphalt-assignment-14716-1', 'seed-usina-asphalt-team-05', 'JR_CONSTRUCOES', 'USINA_ASFALTO_ICARA', 14716, 1, DATE '2025-01-01', NULL, 'Carga inicial 2025', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "UsinaAsphaltTeamAudit" ("id", "teamId", "entityType", "entityId", "action", "note", "after", "createdAt")
SELECT
  'seed-usina-asphalt-team-audit-' || RIGHT(t."id", 2),
  t."id",
  'TEAM',
  t."id",
  'SEEDED',
  'Carga inicial do mapeamento historico de equipes de 2025',
  jsonb_build_object('validFrom', t."validFrom", 'dynamicTeam', TRUE),
  CURRENT_TIMESTAMP
FROM "UsinaAsphaltTeam" t
WHERE t."id" LIKE 'seed-usina-asphalt-team-__'
ON CONFLICT ("id") DO NOTHING;

COMMENT ON TABLE "UsinaAsphaltTeam" IS 'Cadastro dinamico de equipes de asfalto. Nao existe limite de quantidade nem lista fixa de codigos.';
COMMENT ON TABLE "UsinaAsphaltTeamItemAssignment" IS 'Mapa versionado e auditavel ID_ITEM Aethos -> equipe; a classificacao nao interpreta DS_ITEM em tempo de execucao.';

COMMIT;
