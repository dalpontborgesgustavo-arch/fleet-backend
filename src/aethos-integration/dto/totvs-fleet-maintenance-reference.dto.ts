import { IsDateString } from 'class-validator';

export class TotvsFleetMaintenanceReferenceQueryDto {
  @IsDateString({ strict: true })
  dateFrom!: string;

  @IsDateString({ strict: true })
  dateTo!: string;
}

export type TotvsFleetMaintenanceLaborPoolDto = {
  competence: string;
  eligibleLaborPoolAmount: string;
  sourceRowCount: number;
  sourceSentence: 'IND.BI.0035';
  sourceGeneratedAt: string;
  contentHash: string;
};

export type TotvsFleetClassificationDto = {
  fleetNumber: number;
  reportType: 'VEICULOS' | 'CAMINHOES' | 'MAQUINAS' | 'FORA_DO_RATEIO';
  subgroup: string | null;
  eligibleForGeneralAllocation: boolean;
  classificationActive: boolean;
  classificationHash: string;
};

export type TotvsUsinaMonthlyCostTargetDto = {
  aethosVehicleId: number;
  fleetNumber: string;
  targetCostClass: 'CARREGADEIRAS' | 'VEICULO_USINA';
  sortOrder: number;
};

export type TotvsUsinaMonthlyCostConfigurationDto = {
  competence: string;
  companyId: string;
  unitId: string;
  coverage: 'CONFIRMED' | 'MISSING';
  status: 'CONFIRMED' | null;
  configId: string | null;
  version: number | null;
  confirmedAt: string | null;
  targets: TotvsUsinaMonthlyCostTargetDto[];
  contentHash: string;
};

export type TotvsFleetMaintenanceReferenceDto = {
  sourceSentence: 'IND.BI.0035';
  sourceContext: '0/P';
  sourceGeneratedAt: string;
  dateFrom: string;
  dateTo: string;
  authoritativeEligibilityField:
    | 'ENTRA_RATEIO_FROTA'
    | 'LINHA_RATEIO_MO_FALLBACK';
  laborPools: TotvsFleetMaintenanceLaborPoolDto[];
  fleetClassifications: TotvsFleetClassificationDto[];
  monthlyConfigurations: TotvsUsinaMonthlyCostConfigurationDto[];
  reconciliation: {
    sourceRows: number;
    eligibleSourceRows: number;
    responseBytes: number;
    laborPoolMonths: number;
    fleetClassifications: number;
    activeFleetClassifications: number;
    inactiveFleetClassifications: number;
    monthlyConfigurationMonths: number;
    confirmedMonthlyConfigurationMonths: number;
    missingMonthlyConfigurationMonths: number;
    monthlyConfigurationTargets: number;
    monthlyConfigurationsHash: string;
    classificationConflicts: 0;
    contentHash: string;
  };
};
