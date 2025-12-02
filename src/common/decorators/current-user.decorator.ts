import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';

/**
 * Decorator to extract the current user from the request
 * Works after JwtAuthGuard has validated the token
 *
 * Per architecture.md:
 * "Route handlers access user via @CurrentUser() decorator"
 *
 * Usage:
 * @Get('profile')
 * getProfile(@CurrentUser() user: AuthenticatedUser) {
 *   return { id: user.id, email: user.email };
 * }
 *
 * @Get('role')
 * getRole(@CurrentUser('role') role: Role) {
 *   return { role };
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    // If no data key specified, return entire user object
    if (!data) {
      return user;
    }

    // Return specific property of user
    return user?.[data];
  },
);
