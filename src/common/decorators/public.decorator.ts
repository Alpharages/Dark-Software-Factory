import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for public routes
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator to mark routes as public (no authentication required)
 *
 * Usage:
 * @Public()
 * @Get('health')
 * getHealth() { }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
