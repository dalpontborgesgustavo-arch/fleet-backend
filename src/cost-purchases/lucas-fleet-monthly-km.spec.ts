import { calculateMonthlyKm } from './lucas-fleet-monthly-km';

const date = (day: number) =>
  new Date(`2026-10-${String(day).padStart(2, '0')}T00:00:00Z`);

describe('KM mensal da Apresentacao do Lucas', () => {
  it('nao soma intervalos sobrepostos nem a leitura inicial errada da frota 123', () => {
    const result = calculateMonthlyKm([
      {
        aethosVehicleId: 553,
        documentDate: date(1),
        initialKm: 329623,
        currentKm: 330018,
      },
      {
        aethosVehicleId: 553,
        documentDate: date(5),
        initialKm: 30796,
        currentKm: 330891,
      },
      {
        aethosVehicleId: 553,
        documentDate: date(5),
        initialKm: 330018,
        currentKm: 330562,
      },
      {
        aethosVehicleId: 553,
        documentDate: date(28),
        initialKm: 333745,
        currentKm: 334139,
      },
    ]);
    expect(result.kmByVehicle.get(553)).toBe(4516);
  });

  it('nao soma os trechos repetidos da frota 308', () => {
    const result = calculateMonthlyKm([
      {
        aethosVehicleId: 1513,
        documentDate: date(1),
        initialKm: 3238,
        currentKm: 3738,
      },
      {
        aethosVehicleId: 1513,
        documentDate: date(3),
        initialKm: 1573,
        currentKm: 4479,
      },
      {
        aethosVehicleId: 1513,
        documentDate: date(4),
        initialKm: 1543,
        currentKm: 4479,
      },
      {
        aethosVehicleId: 1513,
        documentDate: date(28),
        initialKm: 9866,
        currentKm: 10405,
      },
    ]);
    expect(result.kmByVehicle.get(1513)).toBe(7167);
  });

  it('ignora um pico intermediario isolado e rejeita regressao no fim do mes', () => {
    const result = calculateMonthlyKm([
      {
        aethosVehicleId: 1144,
        documentDate: date(3),
        initialKm: 674979,
        currentKm: 675432,
      },
      {
        aethosVehicleId: 1144,
        documentDate: date(20),
        initialKm: 677581,
        currentKm: 6779180,
      },
      {
        aethosVehicleId: 1144,
        documentDate: date(26),
        initialKm: 678982,
        currentKm: 679461,
      },
      {
        aethosVehicleId: 139,
        documentDate: date(1),
        initialKm: 382775,
        currentKm: 382987,
      },
      {
        aethosVehicleId: 139,
        documentDate: date(16),
        initialKm: 380519,
        currentKm: 381029,
      },
    ]);
    expect(result.kmByVehicle.get(1144)).toBe(4482);
    expect(result.kmByVehicle.has(139)).toBe(false);
    expect(result.inconsistentVehicles).toBe(1);
  });

  it('nao exibe salto extremo na leitura final ou registros sem data', () => {
    const result = calculateMonthlyKm([
      {
        aethosVehicleId: 1,
        documentDate: date(1),
        initialKm: 100000,
        currentKm: 100200,
      },
      {
        aethosVehicleId: 1,
        documentDate: date(30),
        initialKm: 100200,
        currentKm: 1000200,
      },
      {
        aethosVehicleId: 2,
        documentDate: null,
        initialKm: 100,
        currentKm: 200,
      },
    ]);
    expect(result.kmByVehicle.size).toBe(0);
    expect(result.inconsistentVehicles).toBe(1);
  });
});
