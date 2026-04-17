export class CreateOccurrenceDto {
  vehicleId?: string | null;
  checklistId?: string | null;
  questionId?: string | null;
  questionLabel?: string | null;
  description?: string | null;
  severity?: string | null;
  photos?: string[];
}
