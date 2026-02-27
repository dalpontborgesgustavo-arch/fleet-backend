import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const origin = config.get<string>('CORS_ORIGIN') || 'http://localhost:8080';

  app.enableCors({
    origin,
    credentials: true,
  });

  const port = Number(config.get<string>('PORT') || 3000);
  await app.listen(port);
}
bootstrap();