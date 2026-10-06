import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ChecklistController } from './checklist.controller';
import { ChecklistService } from './checklist.service';
import { ChecklistConsentService } from './checklist-consent.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ChecklistController', () => {
  let controller: ChecklistController;
  const findTiReport = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChecklistController],
      providers: [
        {
          provide: ChecklistService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findTiReport,
          },
        },
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn() } },
        },
        {
          provide: ChecklistConsentService,
          useValue: {
            findByToken: jest.fn(),
            respondToConsent: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ChecklistController>(ChecklistController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('allows the TI profile to access the exclusive report', async () => {
    findTiReport.mockResolvedValue({ checklists: [], vehicles: [] });

    await expect(
      controller.findTiReport({ user: { role: 'ti' } }),
    ).resolves.toEqual({ checklists: [], vehicles: [] });
  });

  it('allows the administrator profile to access the exclusive report', async () => {
    findTiReport.mockResolvedValue({ checklists: [], vehicles: [] });

    await expect(
      controller.findTiReport({ user: { role: 'admin' } }),
    ).resolves.toEqual({ checklists: [], vehicles: [] });
  });

  it('rejects other profiles from the exclusive report', () => {
    expect(() =>
      controller.findTiReport({ user: { role: 'gestor' } }),
    ).toThrow('Relatorios exclusivos dos perfis TI e Administrador.');
  });
});
