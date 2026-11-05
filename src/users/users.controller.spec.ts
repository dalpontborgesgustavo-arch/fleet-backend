import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';

describe('UsersController supervisor support profile', () => {
  const prismaUser = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const emailService = {
    sendMail: jest.fn(),
  };
  const controller = new UsersController(
    { user: prismaUser } as any,
    emailService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prismaUser.findMany.mockResolvedValue([]);
    prismaUser.findFirst.mockResolvedValue(null);
    prismaUser.create.mockImplementation(({ data }) => Promise.resolve(data));
    prismaUser.update.mockImplementation(({ data }) => Promise.resolve(data));
    emailService.sendMail.mockResolvedValue({ sent: true, error: null });
  });

  it.each(['supervisor', 'supervisor_apoio'])(
    'gives %s the same manageable user scope',
    async (role) => {
      await controller.findAll({ user: { role } }, 'manageable');

      expect(prismaUser.findMany).toHaveBeenCalledWith({
        where: { active: true, role: { in: ['motorista'] } },
        orderBy: { name: 'asc' },
      });
    },
  );

  it('lets an admin create support while always clearing its fleet type', async () => {
    await controller.create(
      { user: { role: 'admin' } },
      {
        email: 'apoio@jr.com.br',
        name: 'Apoio',
        password: 'temporaria123',
        role: 'SUPERVISOR_APOIO',
        tipoFrota: 'Caminhoes',
      },
    );

    expect(prismaUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'apoio@jr.com.br',
        name: 'Apoio',
        role: 'supervisor_apoio',
        tipoFrota: null,
      }),
    });
  });

  it('allows only an admin to grant license registration to support', async () => {
    await controller.create(
      { user: { role: 'admin' } },
      {
        email: 'apoio-licencas@jr.com.br',
        name: 'Apoio licencas',
        password: 'temporaria123',
        role: 'supervisor_apoio',
        canAccessSsmaLicenses: true,
      },
    );
    expect(prismaUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ canAccessSsmaLicenses: true }),
    });

    await controller.create(
      { user: { role: 'supervisor_apoio' } },
      {
        email: 'motorista-licencas@jr.com.br',
        name: 'Motorista',
        password: 'temporaria123',
        role: 'motorista',
        canAccessSsmaLicenses: true,
      },
    );
    expect(prismaUser.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ canAccessSsmaLicenses: false }),
    });
  });

  it('preserves the individual grant on an unrelated edit and revokes it on role change', async () => {
    prismaUser.findUnique.mockResolvedValue({
      id: 'support-1',
      role: 'supervisor_apoio',
      canAccessSsmaLicenses: true,
      filial: 'PEDRAFORTE',
    });
    await controller.update({ user: { role: 'admin' } }, 'support-1', {
      name: 'Apoio',
    });
    expect(prismaUser.update).toHaveBeenLastCalledWith({
      where: { id: 'support-1' },
      data: expect.objectContaining({ canAccessSsmaLicenses: true }),
    });
    await controller.update({ user: { role: 'admin' } }, 'support-1', {
      role: 'financeiro',
    });
    expect(prismaUser.update).toHaveBeenLastCalledWith({
      where: { id: 'support-1' },
      data: expect.objectContaining({ canAccessSsmaLicenses: false }),
    });
  });

  it('lets an admin create a financial user', async () => {
    await controller.create(
      { user: { role: 'admin' } },
      {
        email: 'financeiro@jr.com.br',
        name: 'Financeiro',
        password: 'temporaria123',
        role: 'FINANCEIRO',
      },
    );

    expect(prismaUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'financeiro@jr.com.br',
        name: 'Financeiro',
        role: 'financeiro',
        tipoFrota: null,
        filial: 'MATRIZ',
      }),
    });
  });

  it('lets an admin create the restricted production profile', async () => {
    await controller.create(
      { user: { role: 'admin' } },
      {
        email: 'lucasrf@jrmc.com.br',
        name: 'Lucas Rodrigues Figueira',
        password: 'temporaria123',
        role: 'administrativo_producao',
      },
    );

    expect(prismaUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'lucasrf@jrmc.com.br',
        role: 'administrativo_producao',
      }),
    });
  });

  it('assigns a user to Filial Norte when requested', async () => {
    await controller.create(
      { user: { role: 'admin' } },
      {
        email: 'norte@jr.com.br',
        name: 'Usuario Norte',
        password: 'temporaria123',
        role: 'financeiro',
        filial: 'Filial Norte',
      },
    );

    expect(prismaUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ filial: 'NORTE' }),
    });
  });

  it('rejects an unknown branch', async () => {
    await expect(
      controller.create(
        { user: { role: 'admin' } },
        {
          email: 'invalido@jr.com.br',
          name: 'Usuario Invalido',
          password: 'temporaria123',
          role: 'financeiro',
          filial: 'Sul',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sends the new user their login, temporary password and first-access link', async () => {
    const result = await controller.create(
      { user: { role: 'admin' } },
      {
        email: 'novo.usuario@jr.com.br',
        name: 'Novo Usuario',
        password: 'SenhaTemporaria123!',
        role: 'financeiro',
      },
    );

    expect(emailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'novo.usuario@jr.com.br',
        subject: 'Seu acesso ao Sistema JR',
        text: expect.stringContaining('SenhaTemporaria123!'),
        html: expect.stringContaining('https://app.jrconstrucoes.net.br'),
      }),
    );
    expect(result).toEqual(expect.objectContaining({ welcomeEmailSent: true }));
  });

  it('keeps the fleet type for a regular supervisor', async () => {
    await controller.create(
      { user: { role: 'admin' } },
      {
        email: 'supervisor@jr.com.br',
        name: 'Supervisor',
        password: 'temporaria123',
        role: 'supervisor',
        tipoFrota: 'Asfalto',
      },
    );

    expect(prismaUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'supervisor',
        tipoFrota: 'Asfalto',
      }),
    });
  });

  it('clears the fleet type when changing a supervisor into support', async () => {
    prismaUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'supervisor@jr.com.br',
      name: 'Supervisor',
      password: 'hash',
      role: 'supervisor',
      tipoFrota: 'Terraplanagem',
      phone: null,
      city: null,
    });

    await controller.update({ user: { role: 'admin' } }, 'user-1', {
      role: 'supervisor_apoio',
      tipoFrota: 'Asfalto',
    });

    expect(prismaUser.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        role: 'supervisor_apoio',
        tipoFrota: null,
      }),
    });
  });

  it('lets support manage motorists but not supervisor profiles', async () => {
    await expect(
      controller.create(
        { user: { role: 'supervisor_apoio' } },
        {
          email: 'motorista@jr.com.br',
          name: 'Motorista',
          password: 'temporaria123',
          role: 'motorista',
        },
      ),
    ).resolves.toBeDefined();

    await expect(
      controller.create(
        { user: { role: 'supervisor_apoio' } },
        {
          email: 'outro@jr.com.br',
          name: 'Outro supervisor',
          password: 'temporaria123',
          role: 'supervisor',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents creating a second shared Motorista / Operador account', async () => {
    prismaUser.findFirst.mockResolvedValueOnce({ id: 'shared-driver' });

    await expect(
      controller.create(
        { user: { role: 'admin' } },
        {
          email: 'outro.motorista@jr.com.br',
          name: 'Outro Motorista',
          password: 'temporaria123',
          role: 'motorista',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaUser.create).not.toHaveBeenCalled();
  });
});
