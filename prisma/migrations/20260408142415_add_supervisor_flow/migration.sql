/*
  Warnings:

  - The values [OPEN] on the enum `OccurrenceStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OccurrenceStatus_new" AS ENUM ('PENDING_SUPERVISOR', 'APPROVED_SUPERVISOR', 'REJECTED_SUPERVISOR', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');
ALTER TABLE "public"."Occurrence" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Occurrence" ALTER COLUMN "status" TYPE "OccurrenceStatus_new" USING ("status"::text::"OccurrenceStatus_new");
ALTER TYPE "OccurrenceStatus" RENAME TO "OccurrenceStatus_old";
ALTER TYPE "OccurrenceStatus_new" RENAME TO "OccurrenceStatus";
DROP TYPE "public"."OccurrenceStatus_old";
ALTER TABLE "Occurrence" ALTER COLUMN "status" SET DEFAULT 'PENDING_SUPERVISOR';
COMMIT;

-- AlterTable
ALTER TABLE "Occurrence" ALTER COLUMN "status" SET DEFAULT 'PENDING_SUPERVISOR';
