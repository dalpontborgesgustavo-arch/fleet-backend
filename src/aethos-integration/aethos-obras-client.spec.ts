import {
  normalizeObras,
  updateWorksWithAethosData,
} from './aethos-integration.service';

describe('Aethos obras client sync', () => {
  it('normalizes the canonical cliente field', () => {
    expect(
      normalizeObras({
        obras: [
          {
            code: '458',
            name: 'OBRA TESTE',
            cliente: 'CLIENTE TESTE S.A.',
            rawId: '458',
            active: true,
          },
        ],
      }),
    ).toEqual([
      {
        code: '458',
        name: 'OBRA TESTE',
        clientName: 'CLIENTE TESTE S.A.',
        rawId: '458',
        active: true,
      },
    ]);
  });

  it('updates work name and client without erasing a manual client when missing upstream', () => {
    const withClient = updateWorksWithAethosData(
      {
        works: [
          { codigoObra: '458', nome: 'ANTIGO', cliente: 'CLIENTE ANTIGO' },
        ],
      },
      new Map([
        [
          '458',
          {
            code: '458',
            name: 'OBRA ATUALIZADA',
            clientName: 'CLIENTE AETHOS',
            rawId: '458',
            active: true,
          },
        ],
      ]),
    );

    expect((withClient.data as any).works[0]).toMatchObject({
      nome: 'OBRA ATUALIZADA',
      cliente: 'CLIENTE AETHOS',
    });

    const withoutClient = updateWorksWithAethosData(
      {
        works: [
          { codigoObra: '458', nome: 'ANTIGO', cliente: 'CLIENTE MANUAL' },
        ],
      },
      new Map([
        [
          '458',
          {
            code: '458',
            name: 'OBRA ATUALIZADA',
            clientName: null,
            rawId: '458',
            active: true,
          },
        ],
      ]),
    );

    expect((withoutClient.data as any).works[0]).toMatchObject({
      nome: 'OBRA ATUALIZADA',
      cliente: 'CLIENTE MANUAL',
    });
  });
});
