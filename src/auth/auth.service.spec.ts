import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            refreshToken: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('keeps the support role and global fleet scope in the auth response', async () => {
    const prisma = service['prisma'] as any;
    const jwtService = service['jwtService'] as any;

    prisma.user.findUnique.mockResolvedValue({
      id: 'support-1',
      email: 'apoio@jr.com.br',
      name: 'Apoio',
      password: await bcrypt.hash('senha123', 4),
      role: 'SUPERVISOR_APOIO',
      tipoFrota: null,
      filial: 'NORTE',
      mustChangePassword: false,
    });
    prisma.refreshToken.create.mockResolvedValue({ id: 'refresh-1' });
    jwtService.sign.mockReturnValue('jwt-token');

    const response = await service.login({
      email: 'apoio@jr.com.br',
      password: 'senha123',
    });

    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'supervisor_apoio',
        tipoFrota: null,
        filial: 'NORTE',
      }),
    );
    expect(response.user).toEqual(
      expect.objectContaining({
        role: 'supervisor_apoio',
        tipoFrota: null,
        filial: 'NORTE',
      }),
    );
  });
});
