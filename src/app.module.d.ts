import { MiddlewareConsumer, NestModule } from '@nestjs/common';
export declare class AppModule implements NestModule {
    /**
     * Configure middleware for all routes
     */
    configure(consumer: MiddlewareConsumer): void;
}
/**
 * Bootstrap the NestJS application
 */
export declare function bootstrap(): Promise<void>;
