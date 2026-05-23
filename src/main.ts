import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  
  // Enable CORS for all origins
  app.enableCors({
    origin: true,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization,X-Device-ID,X-Idempotency-Key,X-Forwarded-For',
  });
  
  // Setup Swagger/OpenAPI documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Core Banking Platform API')
    .setDescription('Production-grade banking platform with blockchain anchoring, peer-to-peer transfers, and real-time updates')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);
  
  const port = config.get<number>('PORT', 3000);
  
  await app.listen(port);
  console.log(`✅ Server running on http://localhost:${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}

bootstrap().catch((err) => {
  console.error('❌ Server failed to start:', err);
  process.exit(1);
});
