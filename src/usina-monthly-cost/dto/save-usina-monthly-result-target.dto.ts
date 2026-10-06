export class SaveUsinaMonthlyResultTargetDto {
  competence!: string;
  targetRate?: string | number | null;
  observation?: string | null;
  changeReason?: string | null;
}

export class CopyUsinaMonthlyResultTargetDto {
  competence!: string;
  changeReason?: string | null;
}

export class DeleteUsinaMonthlyResultTargetDto {
  reason?: string | null;
}
