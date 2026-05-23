/**
 * @file current-user.decorator.ts
 * @description Parameter decorator that extracts the authenticated user from
 * the request object after `AuthGuard` has validated the JWT and attached the
 * user payload to `request.user`.
 *
 * Usage in controllers (matches existing TransferController and new
 * UpiPaymentController):
 *
 *   @Get('profile')
 *   @UseGuards(AuthGuard)
 *   getProfile(@CurrentUser() user: AuthenticatedUser) {
 *     return user;
 *   }
 *
 * Optionally pass a property name to extract a specific field:
 *
 *   @Get('balance')
 *   @UseGuards(AuthGuard)
 *   getBalance(@CurrentUser('id') userId: string) { ... }
 *
 * Integration:
 *   - AuthGuard sets `request.user` before this decorator runs.
 *   - TransferController uses `@CurrentUser() currentUser: any` — this
 *     decorator is a drop-in replacement that adds the type.
 *   - UpiPaymentController uses `@CurrentUser() user: AuthenticatedUser`.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from './auth.guard';

export const CurrentUser = createParamDecorator(
  (
    property: keyof AuthenticatedUser | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedUser | string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    // If a specific property was requested (e.g. @CurrentUser('id')), return it.
    return property ? user?.[property] : user;
  },
);
