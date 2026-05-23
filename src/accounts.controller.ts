import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';

@Controller('api/v1/accounts')
@ApiTags('Accounts')
export class AccountsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @UseGuards(AuthGuard)
  async list(@CurrentUser('id') userId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, accountNumber: true, currentBalance: true, currency: true },
    });
    return { data: accounts };
  }
}
