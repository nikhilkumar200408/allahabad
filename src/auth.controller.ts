import { Controller, Post, Get, Body, HttpCode, HttpStatus, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthenticationService } from './authentication.service';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { PrismaService } from './prisma.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private authService: AuthenticationService,
    private prisma: PrismaService,
  ) {}

  @Post('register')
  async register(
    @Body() body: { 
      email: string; 
      password: string; 
      firstName: string; 
      lastName: string;
      phoneNumber: string 
    }
  ) {
    return this.authService.register(
      body.email,
      body.password,
      body.firstName,
      body.lastName,
      body.phoneNumber
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { 
      email: string; 
      password: string; 
      deviceId?: string;
    },
    @Req() request: Request
  ) {
    const userAgent = request.headers['user-agent'] || 'Unknown';
    const ipAddress = request.ip || '0.0.0.0';
    
    return this.authService.login(
      body.email,
      body.password,
      body.deviceId || 'web-device',
      userAgent,
      ipAddress
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: { refreshToken: string },
  ) {
    if (!body?.refreshToken) {
      throw new BadRequestException('refreshToken is required');
    }
    return { accessToken: await this.authService.refreshAccessToken(body.refreshToken) };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser('id') userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        upiHandle: true,
        kycStatus: true,
        accounts: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            currentBalance: true,
            currency: true,
          },
          take: 1,
        },
      },
    });

    return {
      user: {
        id: user?.id,
        email: user?.email,
        upiHandle: user?.upiHandle,
        kycStatus: user?.kycStatus,
      },
      account: user?.accounts?.[0] ?? null,
    };
  }

  @Post('verify-kyc')
  @UseGuards(AuthGuard)
  async verifyKYC(
    @CurrentUser('id') userId: string,
    @Body() body: {
      fullName: string;
      documentType: 'AADHAR' | 'PAN' | 'DRIVING_LICENSE';
      documentNumber: string;
      dateOfBirth: string;
    }
  ) {
    return this.authService.verifyKYC(userId, {
      fullName: body.fullName,
      documentType: body.documentType,
      documentNumber: body.documentNumber,
      dateOfBirth: body.dateOfBirth,
    });
  }
}