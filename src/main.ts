import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });

  const allowedOrigins = [
    'https://app.jrconstrucoes.net.br',
    'https://vehicle-checkup-pro.vercel.app',
    'http://localhost:8080',
    'http://localhost:3000',
  ];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  await app.listen(3000);
}
void bootstrap();
