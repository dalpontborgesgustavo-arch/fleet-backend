import { RncStatus } from '@prisma/client';

export class UpdateRncProgressDto {
  respondido?: boolean;
  planoAcaoSolucao?: string;
  status?: RncStatus;
  valorRetido?: number | string | null;
  dataAssinatura?: string | null;
  obs?: string;
}
