export class SaveUsinaMonthlyStonePowderFreightDto {
  competence!: string;
  unitCostPerM3!: string | number;
  observation?: string | null;
  changeReason?: string | null;
}

export class CopyUsinaMonthlyStonePowderFreightDto {
  competence!: string;
  changeReason?: string | null;
}

export class DeleteUsinaMonthlyStonePowderFreightDto {
  reason?: string | null;
}
