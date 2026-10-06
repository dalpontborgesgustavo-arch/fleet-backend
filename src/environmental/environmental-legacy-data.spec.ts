import { buildLegacyEnvironmentalRecords } from './environmental-legacy-data';

describe('buildLegacyEnvironmentalRecords', () => {
  it('normaliza o histórico útil sem transformar células vazias em zero', () => {
    const records = buildLegacyEnvironmentalRecords();

    expect(records).toHaveLength(494);
    expect(new Set(records.map((record) => record.externalKey)).size).toBe(494);
    expect(records.every((record) => Number.isFinite(record.amount))).toBe(
      true,
    );
    expect(records.every((record) => record.amount >= 0)).toBe(true);
    expect(
      records.filter((record) => record.domain === 'RESOURCE'),
    ).toHaveLength(322);
    expect(records.filter((record) => record.domain === 'WASTE')).toHaveLength(
      148,
    );
    expect(
      records.filter((record) => record.domain === 'OPACITY'),
    ).toHaveLength(24);
    expect(records.filter((record) => record.domain === 'GHG')).toHaveLength(0);
  });

  it('mantém Ringelmann fora do inventário de GEE', () => {
    const records = buildLegacyEnvironmentalRecords();
    const opacity = records.filter((record) => record.domain === 'OPACITY');

    expect(opacity.every((record) => record.metric === 'RINGELMANN')).toBe(
      true,
    );
    expect(opacity.every((record) => record.amount === 1)).toBe(true);
    expect(
      opacity.every((record) => record.details.assetType === 'CHIMNEY'),
    ).toBe(true);
  });
});
