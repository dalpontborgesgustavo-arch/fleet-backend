export class CreateOccurrenceDto {
  vehicleId?: string | null;
  checklistId?: string | null;
  questionId?: string | null;
  questionLabel?: string | null;
  description?: string | null;
  severity?: string | null;
  isEmergency?: boolean | null;
  responsavelUserId?: string | null;
  maintenanceTargetUserId?: string | null;
  photos?: string[];
}
