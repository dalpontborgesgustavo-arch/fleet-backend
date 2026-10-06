CREATE TYPE "Filial" AS ENUM ('MATRIZ', 'NORTE');

ALTER TABLE "User"
  ADD COLUMN "filial" "Filial" NOT NULL DEFAULT 'MATRIZ';

ALTER TABLE "Vehicle"
  ADD COLUMN "filial" "Filial" NOT NULL DEFAULT 'MATRIZ';

CREATE INDEX "User_filial_idx" ON "User"("filial");
CREATE INDEX "Vehicle_filial_idx" ON "Vehicle"("filial");
