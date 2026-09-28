import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:8081,http://127.0.0.1:8081')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => callback(null, !origin || configuredOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-correlation-id'],
    maxAge: 600,
  });
  const adapter = app.getHttpAdapter().getInstance() as { set: (name: string, value: unknown) => void; use: (handler: (request: { secure?: boolean; headers: Record<string, string | string[] | undefined> }, response: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => void) => void };
  adapter.set('json spaces', 0);
  if (process.env.ENFORCE_HTTPS === 'true') {
    adapter.use((request, response, next) => {
      const forwarded = request.headers['x-forwarded-proto'];
      if (request.secure || forwarded === 'https') return next();
      response.status(426).json({ code: 'HTTPS_REQUIRED' });
    });
  }
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
