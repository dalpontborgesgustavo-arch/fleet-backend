type MonthlySeries = {
  metric: string;
  site: string;
  unit: string;
  reference?: string;
  values: Record<number, Array<number | null>>;
};

type LegacyEnvironmentalRecord = {
  domain: string;
  metric: string;
  company: string;
  competence: Date;
  recordedAt?: Date;
  site?: string;
  asset?: string;
  amount: number;
  unit: string;
  source: string;
  externalKey: string;
  details: Record<string, unknown>;
  notes?: string;
};

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

const RESOURCE_SERIES: MonthlySeries[] = [
  {
    metric: 'ENERGY_CONSUMPTION',
    site: 'Escritório Central',
    unit: 'kWh',
    values: {
      2023: [
        1018, 1249, 1337, 1232, 1054, 1318, 1100, 1285, 1210, 1171, 1148, 1655,
      ],
      2024: [
        1393, 2229, 2211, 2240, 1956, 1700, 1969, 1415, 1614, 2452, 1677, 1779,
      ],
      2025: [
        1727, 2232, 2081, 1845, 1691, 1606, 2212, 2085, 1726, 2015, 1859, 2421,
      ],
      2026: [
        1585,
        2766,
        2806,
        2471,
        2064,
        2215,
        2756,
        null,
        null,
        null,
        null,
        null,
      ],
    },
  },
  {
    metric: 'ENERGY_CONSUMPTION',
    site: 'Usina',
    unit: 'kWh',
    values: {
      2023: [
        13962, 8976, 8687, 9123, 11646, 11878, 12002, 14979, 11833, 13405,
        12999, 13961,
      ],
      2024: [
        11576, 17708, 18326, 14993, 18394, 17297, 17345, 19257, 19538, 20635,
        15123, 14541,
      ],
      2025: [
        20175, 18285, 21146, 21086, 29631, 23297, 28457, 35472, 38113, 35607,
        40173, 25991,
      ],
      2026: [
        33978,
        36029,
        36965,
        33940,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    },
  },
  {
    metric: 'ENERGY_CONSUMPTION',
    site: 'Laboratório',
    unit: 'kWh',
    values: {
      2023: [
        1474, 1524, 1542, 1530, 1538, 1530, 1531, 1563, 1605, 1626, 1663, 1738,
      ],
      2024: [
        1859, 2138, 2302, 2447, 2563, 2487, 2477, 2305, 2050, 2351, 2790, 2326,
      ],
      2025: [
        3100, 3620, 3763, 3112, 1735, 1787, 2483, 3429, 3770, 3956, 3376, 3862,
      ],
      2026: [
        3304,
        4623,
        4922,
        5314,
        3882,
        3812,
        3911,
        null,
        null,
        null,
        null,
        null,
      ],
    },
  },
  {
    metric: 'ENERGY_GENERATION',
    site: 'Escritório Central 01',
    unit: 'kWh',
    values: {
      2023: [421, 704, 635, 515, 173, 153, 166, 154, 160, 57, 71, 89],
      2024: [95, 126, 124, 150, 132, 100, 178, 100, 100, 216, 677, 154],
      2025: [568, 247, 280, 232, 120, 123, 171, 195, 170, 115, 116, 212],
      2026: [255, 307, 420, 498, 174, 123, 232, null, null, null, null, null],
    },
  },
  {
    metric: 'ENERGY_GENERATION',
    site: 'Escritório Central 02',
    unit: 'kWh',
    values: {
      2023: [735, 1454, 1184, 1028, 545, 653, 710, 663, 583, 396, 292, 313],
      2024: [429, 641, 517, 595, 461, 470, 906, 352, 292, 278, 361, 311],
      2025: [349, 545, 543, 449, 267, 391, 564, 493, 427, 369, 351, 383],
      2026: [415, 455, 603, 740, 308, 502, 733, null, null, null, null, null],
    },
  },
  {
    metric: 'WATER_CONSUMPTION',
    site: 'Escritório Central',
    unit: 'm³',
    reference: 'UC 4467256',
    values: {
      2023: [109, 59, 96, 68, 83, 94, 88, 92, 86, 83, 87, 56],
      2024: [53, 116, 70, 76, 135, 120, 69, 3, 3, 4, 3, 7],
      2025: [2, 6, 42, 4, 5, 8, 59, 30, 17, 26, 18, 21],
      2026: [10, 20, 12, 17, 42, 10, 5, null, null, null, null, null],
    },
  },
  {
    metric: 'WATER_CONSUMPTION',
    site: 'Usina + Laboratório',
    unit: 'm³',
    reference: 'UC 16593049',
    values: {
      2023: [53, 77, 42, 40, 36, 48, 50, 48, 41, 34, 36, 35],
      2024: [41, 43, 48, 49, 11, 5, 8, 5, 21, 0, 5, 3],
      2025: [5, 8, 6, 7, 8, 8, 8, 5, 10, 4, 6, 4],
      2026: [34, 99, 81, 103, 108, 60, 62, null, null, null, null, null],
    },
  },
  {
    metric: 'PRODUCTION',
    site: 'Usina',
    unit: 't',
    values: {
      2023: [
        8199.16, 4720.69, 4173.51, 5079.21, 6545.34, 5795.01, 6682.57, 9241.53,
        7122.38, 8990.53, 7240.71, 7893.64,
      ],
      2024: [
        5309.41, 10123, 11490.69, 9717.38, 10713.34, 8846.13, 8108.41, 11956.89,
        12283.8, 14446, 10646, 11287,
      ],
    },
  },
];

const WASTE_SERIES: Array<{
  metric: string;
  values: Record<number, Array<number | null>>;
}> = [
  {
    metric: 'ORGANIC',
    values: {
      2023: [285, 245, 298, 315, 289, 421, 485, 397, 435, 458, 498, 512],
      2024: [310, 478, 425, 562, 485, 524, 386, 418, 478, 514, 528, 547],
      2025: [540, 582, 496, 512, 587, 610, 524, 497, 515, 602, 702, 521],
      2026: [
        698,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    },
  },
  {
    metric: 'RECYCLABLE',
    values: {
      2023: [857, 985, 867, 954, 865, 987, 868, 789, 854, 925, 879, 985],
      2024: [982, 658, 987, 1065, 986, 825, 758, 982, 1036, 996, 1015, 895],
      2025: [1125, 820, 1025, 925, 852, 968, 1245, 524, 782, 1057, 1185, 1425],
      2026: [
        1752,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    },
  },
  {
    metric: 'REJECT',
    values: {
      2023: [
        15000, 19000, 36000, 42000, 36000, 36000, 28000, 48000, 36000, 32000,
        36000, 25000,
      ],
      2024: [
        26000, 32000, 38000, 32000, 36000, 36000, 28000, 36000, 30000, 26000,
        36000, 38000,
      ],
      2025: [
        32000, 36000, 32000, 36000, 38000, 42000, 36000, 45000, 32000, 36000,
        38000, 36000,
      ],
      2026: [
        20000,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    },
  },
  {
    metric: 'HAZARDOUS',
    values: {
      2023: [
        5080, 880, 5430, 60, 960, 5510, 4000, 8330, 4800, 7390, 810, 14710,
      ],
      2024: [
        3700, 260, 4250, 3360, 1970, 7170, 9330, 3220, 3260, 23230, 9750, 0,
      ],
      2025: [
        4000, 10703, 3795, 4050, 6792, 6953, 6817, 3370, 9336, 6544, 7757, 6014,
      ],
      2026: [
        6000,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    },
  },
];

const RINGELMANN_ROWS: Array<[string, string]> = [
  ['2025-01-03', '14:55'],
  ['2025-01-04', '07:28'],
  ['2025-01-06', '07:33'],
  ['2025-01-07', '07:29'],
  ['2025-01-08', '07:35'],
  ['2025-01-09', '07:28'],
  ['2025-01-10', '07:31'],
  ['2025-01-11', '07:33'],
  ['2025-01-13', '07:29'],
  ['2025-01-14', '07:35'],
  ['2025-01-15', '07:45'],
  ['2025-01-16', '07:23'],
  ['2025-01-17', '07:35'],
  ['2025-01-18', '07:33'],
  ['2025-01-20', '07:25'],
  ['2025-01-21', '07:35'],
  ['2025-01-22', '07:31'],
  ['2025-01-23', '07:35'],
  ['2025-01-24', '07:34'],
  ['2025-01-25', '07:35'],
  ['2025-01-27', '07:32'],
  ['2025-01-28', '07:23'],
  ['2025-01-29', '07:33'],
  ['2025-01-30', '07:34'],
];

function expandMonthlySeries(): LegacyEnvironmentalRecord[] {
  return RESOURCE_SERIES.flatMap((series) =>
    Object.entries(series.values).flatMap(([yearText, values]) =>
      MONTHS.flatMap((month) => {
        const amount = values[month - 1];
        if (amount === null || amount === undefined) return [];
        const year = Number(yearText);
        const siteKey = series.site.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return [
          {
            domain: 'RESOURCE',
            metric: series.metric,
            company: 'JR_CONSTRUCOES',
            competence: new Date(Date.UTC(year, month - 1, 1, 12)),
            site: series.site,
            amount,
            unit: series.unit,
            source: 'LEGACY_SPREADSHEET',
            externalKey: `legacy-resource:${series.metric}:${siteKey}:${year}-${String(month).padStart(2, '0')}`,
            details: {
              originalWorkbook: 'Gestão de Energia e Água.xlsx',
              ...(series.reference ? { reference: series.reference } : {}),
            },
          },
        ];
      }),
    ),
  );
}

function expandWasteSeries(): LegacyEnvironmentalRecord[] {
  return WASTE_SERIES.flatMap((series) =>
    Object.entries(series.values).flatMap(([yearText, values]) =>
      MONTHS.flatMap((month) => {
        const amount = values[month - 1];
        if (amount === null || amount === undefined) return [];
        const year = Number(yearText);
        return [
          {
            domain: 'WASTE',
            metric: series.metric,
            company: 'JR_CONSTRUCOES',
            competence: new Date(Date.UTC(year, month - 1, 1, 12)),
            site: 'Escopo JR Construções',
            amount,
            unit: 'kg',
            source: 'LEGACY_SPREADSHEET',
            externalKey: `legacy-waste:${series.metric}:${year}-${String(month).padStart(2, '0')}`,
            details: {
              originalWorkbook: 'Gestão PGRS.xlsx',
              measurementKind: 'MONTHLY_AGGREGATE',
            },
          },
        ];
      }),
    ),
  );
}

function expandRingelmannRows(): LegacyEnvironmentalRecord[] {
  return RINGELMANN_ROWS.map(([date, time]) => ({
    domain: 'OPACITY',
    metric: 'RINGELMANN',
    company: 'JR_CONSTRUCOES',
    competence: new Date(`${date.slice(0, 7)}-01T12:00:00.000Z`),
    recordedAt: new Date(`${date}T${time}:00-03:00`),
    site: 'UA01 - Içara, SC',
    asset: 'Chaminé da Usina de Asfalto',
    amount: 1,
    unit: 'nível Ringelmann',
    source: 'LEGACY_SPREADSHEET',
    externalKey: `legacy-ringelmann:${date}:${time}`,
    details: {
      originalWorkbook: 'Gestão das emissões de GEE.xlsx',
      measurementType: 'Rotina',
      assetType: 'CHIMNEY',
      responsible: 'ROBSON',
    },
  }));
}

export function buildLegacyEnvironmentalRecords(): LegacyEnvironmentalRecord[] {
  return [
    ...expandMonthlySeries(),
    ...expandWasteSeries(),
    ...expandRingelmannRows(),
  ];
}
