import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/** Punto de entrada: crea la app NestJS, configura CORS, validación global, Swagger e inicia el servidor. */
async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);


  // ==========================================================
  // CONFIGURACIÓN DE PUERTOS
  // ==========================================================
  const port = process.env.PORT || 3000;

  // ==========================================================
  // PREFIJO GLOBAL /api
  // ==========================================================
  app.setGlobalPrefix('api');

  // ==========================================================
  // CONFIGURACIÓN DE CORS (SOPORTE PARA 2 FRONTENDS + MÓVIL)
  // ==========================================================
  const envOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
    : [];

  app.enableCors({
    origin: [
      ...envOrigins,                      // Lo que pusiste en el .env
      'http://localhost:5173',            // Frontend CLIENTE
      'http://localhost:5174',            // Frontend ADMIN <--- IMPORTANTE
      'http://localhost:8081',            // Expo Metro Bundler Local
      /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:8081$/, // Regex para cualquier IP local de Expo
      /.*\.ngrok-free\.dev$/,             // Permite tu dominio ngrok actual
      /.*\.ngrok-free\.app$/              // Por si cambia la terminación
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    // Headers permitidos (Incluimos los de ngrok y pasarelas de pago)
    allowedHeaders: 'Content-Type, Accept, Authorization, ngrok-skip-browser-warning, x-signature, x-request-id', 
  });

  // ==========================================================
  // VALIDACIÓN GLOBAL
  // ==========================================================
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ==========================================================
  // SWAGGER CONFIG
  // ==========================================================
  const config = new DocumentBuilder()
    .setTitle('AERONET API')
    .setDescription('Sistema de Gestión para AeroNet (Backend)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // ==========================================================
  // INICIO DEL SERVIDOR
  // ==========================================================
  // Escuchar en 0.0.0.0 permite que Docker y Ngrok se conecten correctamente
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 NestJS escuchando en puerto: ${port}`);
  logger.log(`🌍 Backend Público (Ngrok): ${process.env.BACKEND_URL}`);
  logger.log(`💻 Frontend Cliente Permitido: http://localhost:5173`);
  logger.log(`🛡️ Frontend Admin Permitido: http://localhost:5174`);
}
bootstrap();