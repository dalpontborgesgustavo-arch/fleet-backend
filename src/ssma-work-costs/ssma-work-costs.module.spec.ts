import { INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AethosIntegrationModule } from '../aethos-integration/aethos-integration.module';
import { AethosIntegrationService } from '../aethos-integration/aethos-integration.service';
import { PrismaService } from '../prisma/prisma.service';
import { SsmaWorkCostsModule } from './ssma-work-costs.module';

@Module({
  providers: [
    { provide: AethosIntegrationService, useValue: { assertToken: jest.fn() } },
  ],
  exports: [AethosIntegrationService],
})
class MockAethosIntegrationModule {}

describe('SsmaWorkCostsModule wiring', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('starts with JwtGuard dependencies and rejects an anonymous read', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'ssma-module-test-secret' })],
        }),
        SsmaWorkCostsModule,
      ],
    })
      .overrideModule(AethosIntegrationModule)
      .useModule(MockAethosIntegrationModule)
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer()).get('/ssma/work-costs').expect(401);
  });
});
