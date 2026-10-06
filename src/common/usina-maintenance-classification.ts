export const USINA_MAINTENANCE_AETHOS_VEHICLE_IDS = [426] as const;
export const USINA_DIESEL_ACCOUNT_PLAN_MARKER = 'FROTA DIESEL TANQUE JR';

function fold(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

export function classifyUsinaVehicleExpense(
  aethosVehicleId: number | null | undefined,
  accountPlanDescription: string | null | undefined,
) {
  if (
    !USINA_MAINTENANCE_AETHOS_VEHICLE_IDS.includes(
      Number(aethosVehicleId) as 426,
    )
  ) {
    return 'VEHICLE_EXPENSE' as const;
  }
  return fold(accountPlanDescription).includes(
    USINA_DIESEL_ACCOUNT_PLAN_MARKER,
  )
    ? ('DIESEL_USINA' as const)
    : ('MANUTENCAO_USINA' as const);
}
