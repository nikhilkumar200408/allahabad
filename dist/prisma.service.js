"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PrismaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
let PrismaService = PrismaService_1 = class PrismaService extends client_1.PrismaClient {
    constructor(config) {
        const nodeEnv = config.get('NODE_ENV', 'development');
        const isDev = nodeEnv !== 'production';
        super({
            datasources: {
                db: {
                    url: config.get('DATABASE_URL'),
                },
            },
            log: isDev
                ? [
                    { emit: 'event', level: 'query' },
                    { emit: 'event', level: 'info' },
                    { emit: 'event', level: 'warn' },
                    { emit: 'event', level: 'error' },
                ]
                : [
                    { emit: 'event', level: 'warn' },
                    { emit: 'event', level: 'error' },
                ],
            errorFormat: isDev ? 'pretty' : 'minimal',
        });
        this.config = config;
        this.logger = new common_1.Logger(PrismaService_1.name);
        if (isDev) {
            this.$on('query', (e) => {
                if (e.duration > 2000) {
                    this.logger.warn(`[SLOW QUERY ${e.duration}ms] ${e.query} — params: ${e.params}`);
                }
                else {
                    this.logger.debug(`[QUERY ${e.duration}ms] ${e.query}`);
                }
            });
            this.$on('info', (e) => {
                this.logger.log(`[PRISMA INFO] ${e.message}`);
            });
        }
        this.$on('warn', (e) => {
            this.logger.warn(`[PRISMA WARN] ${e.message}`);
        });
        this.$on('error', (e) => {
            this.logger.error(`[PRISMA ERROR] ${e.message}`);
        });
    }
    async onModuleInit() {
        const maxRetries = 5;
        let attempt = 0;
        while (attempt < maxRetries) {
            try {
                await this.$connect();
                this.logger.log('[PRISMA] Database connection established.');
                await this.$queryRaw `SELECT 1 AS ping`;
                this.logger.log('[PRISMA] Database health check passed.');
                return;
            }
            catch (err) {
                attempt++;
                this.logger.error(`[PRISMA] Connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
                if (attempt < maxRetries) {
                    const delay = 500 * Math.pow(2, attempt - 1);
                    this.logger.log(`[PRISMA] Retrying in ${delay}ms…`);
                    await this.sleep(delay);
                }
            }
        }
        throw new Error(`[PRISMA] Could not connect to the database after ${maxRetries} attempts. Aborting startup.`);
    }
    async onModuleDestroy() {
        await this.$disconnect();
        this.logger.log('[PRISMA] Database connection closed gracefully.');
    }
    enableShutdownHooks(app) {
        this.$on('beforeExit', async () => {
            this.logger.log('[PRISMA] beforeExit — closing NestJS app.');
            await app.close();
        });
    }
    async isHealthy() {
        try {
            await this.$queryRaw `SELECT 1`;
            return true;
        }
        catch {
            return false;
        }
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
};
exports.PrismaService = PrismaService;
exports.PrismaService = PrismaService = PrismaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], PrismaService);
//# sourceMappingURL=prisma.service.js.map