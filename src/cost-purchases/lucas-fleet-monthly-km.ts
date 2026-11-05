type OdometerReading = {
  aethosVehicleId: number;
  documentDate: Date | null;
  initialKm: unknown;
  currentKm: unknown;
};

// A leitura inicial do primeiro abastecimento e a leitura final do ultimo
// delimitam o mes. Somar cada intervalo repete trechos quando o Aethos
// registra abastecimentos sobrepostos ou lancamentos retroativos.
export function calculateMonthlyKm(readings: readonly OdometerReading[]) {
  const byVehicle = new Map<
    number,
    Array<{
      date: number;
      initial: number;
      current: number;
    }>
  >();

  for (const reading of readings) {
    const date = reading.documentDate?.getTime();
    const initial = Number(reading.initialKm);
    const current = Number(reading.currentKm);
    if (
      date === undefined ||
      !Number.isFinite(date) ||
      !Number.isFinite(initial) ||
      !Number.isFinite(current) ||
      initial <= 0 ||
      current <= initial
    )
      continue;
    const vehicleReadings = byVehicle.get(reading.aethosVehicleId) ?? [];
    vehicleReadings.push({ date, initial, current });
    byVehicle.set(reading.aethosVehicleId, vehicleReadings);
  }

  const kmByVehicle = new Map<number, number>();
  let inconsistentVehicles = 0;
  for (const [vehicleId, vehicleReadings] of byVehicle) {
    // Leitura menor primeiro em um mesmo dia; a maior encerra o dia.
    vehicleReadings.sort((a, b) => a.date - b.date || a.current - b.current);
    const initial = vehicleReadings[0].initial;
    const current = vehicleReadings[vehicleReadings.length - 1].current;
    const distance = current - initial;
    // Mais de 50 mil km em um mes por um unico veiculo sugere erro de
    // digitacao ou troca de hodometro. Nao publicar um numero inventado.
    if (!Number.isFinite(distance) || distance <= 0 || distance > 50_000) {
      inconsistentVehicles++;
      continue;
    }
    kmByVehicle.set(vehicleId, distance);
  }
  return { kmByVehicle, inconsistentVehicles };
}
