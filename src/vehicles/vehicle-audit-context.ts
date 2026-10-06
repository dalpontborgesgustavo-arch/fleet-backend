import { Prisma } from '@prisma/client';

export type VehicleAuditSource =
  | 'MANUAL'
  | 'AETHOS'
  | 'CHECKLIST_MENSAL'
  | 'SYSTEM';

export type VehicleAuditActor = {
  source: VehicleAuditSource;
  userId?: string | null;
  name?: string | null;
  email?: string | null;
};

export async function setVehicleAuditContext(
  transaction: Prisma.TransactionClient,
  actor: VehicleAuditActor,
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`
      SELECT
        set_config('app.vehicle_audit_source', ${actor.source}, true) AS source,
        set_config('app.vehicle_audit_user_id', ${actor.userId || ''}, true) AS user_id,
        set_config('app.vehicle_audit_user_name', ${actor.name || ''}, true) AS user_name,
        set_config('app.vehicle_audit_user_email', ${actor.email || ''}, true) AS user_email
    `,
  );
}
