import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { patchNestJsSwagger } from 'nestjs-zod';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import express, { type Request, type Response, type NextFunction } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';

/**
 * Engine.IO clients often use `/api/socket.io?EIO=…` (no slash before `?`). May still 404 if the adapter runs
 * before this middleware — the Next.js proxy normalizes to `/api/socket.io/?…` for upstream fetch.
 */
function normalizeEngineIoUrl(req: Request, _res: Response, next: NextFunction): void {
  const u = req.url ?? '';
  const q = u.indexOf('?');
  const pathOnly = q === -1 ? u : u.slice(0, q);
  if (pathOnly === '/api/socket.io') {
    req.url = '/api/socket.io/' + (q === -1 ? '' : u.slice(q));
  }
  next();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.use(normalizeEngineIoUrl);

  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  app.use(cookieParser());
  app.use(helmet());

  const corsOrigins = configService.get<string>('CORS_ORIGINS', '');
  app.enableCors({
    origin: corsOrigins.split(',').map((o) => o.trim()),
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  patchNestJsSwagger();
  const swaggerConfig = new DocumentBuilder()
    .setTitle('RentAI API')
    .setDescription('API for RentAI short-term rental management platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('PORT', 3000);
  const host = configService.get<string>('HOST', '::');
  await app.listen(port, host);
  logger.log(`Listening on ${host}:${port} (e.g. http://127.0.0.1:${port}/api/docs)`);
}

bootstrap();
