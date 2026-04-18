export class CreatePartRequestDto {
  occurrenceId!: string;
  description!: string;
  quantity?: number;
  notes?: string;
}
