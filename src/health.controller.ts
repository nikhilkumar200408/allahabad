import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';

@Controller()
@ApiTags('Health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Root redirect to API docs / basic health' })
  root(@Res() res: Response) {
    return res.redirect('/api/docs');
  }
}
