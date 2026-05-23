"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("./app.module");
const config_1 = require("@nestjs/config");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const config = app.get(config_1.ConfigService);
    app.enableCors({
        origin: true,
        credentials: true,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        allowedHeaders: 'Content-Type,Authorization,X-Device-ID,X-Idempotency-Key,X-Forwarded-For',
    });
    const swaggerConfig = new swagger_1.DocumentBuilder()
        .setTitle('Core Banking Platform API')
        .setDescription('Production-grade banking platform with blockchain anchoring, peer-to-peer transfers, and real-time updates')
        .setVersion('1.0.0')
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
    swagger_1.SwaggerModule.setup('api/docs', app, document);
    const port = config.get('PORT', 3000);
    await app.listen(port);
    console.log(`✅ Server running on http://localhost:${port}`);
    console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}
bootstrap().catch((err) => {
    console.error('❌ Server failed to start:', err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map