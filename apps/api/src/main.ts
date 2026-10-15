import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors();
  app.use(helmet());
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  const docs = new DocumentBuilder().setTitle('Workflow Creator API').setVersion('0.1').build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, docs));
  await app.listen(Number(process.env.API_PORT ?? 4000));
}
bootstrap();