import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { Role, ROLE_PERMISSIONS } from '../constants/roles.enum';
import { LoggerService } from '../../common/logger';
import { setUserContext } from '../../common/context';

/**
 * JWT Strategy for Passport
 * Validates JWT tokens and extracts user information
 *
 * Per architecture.md Authentication Flow:
 * 1. Frontend includes JWT in requests: Authorization: Bearer {jwt}
 * 2. Orchestrator validates JWT via auth.guard.ts:
 *    - Verifies signature using shared secret
 *    - Checks expiration
 *    - Extracts user claims
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const jwtSecret = configService.get<string>('auth.jwtSecret');

    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not configured. Set it in your .env file.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // Automatically reject expired tokens
      secretOrKey: jwtSecret,
      algorithms: ['HS256'], // Only accept HS256 signed tokens
    });

    this.logger.log('JWT Strategy initialized');
  }

  /**
   * Validate JWT payload and transform to AuthenticatedUser
   * Called automatically by Passport after token signature verification
   *
   * @param payload - Decoded JWT payload
   * @returns AuthenticatedUser object attached to request
   * @throws UnauthorizedException if validation fails
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Validate required fields
    if (!payload.sub) {
      this.logger.warn('JWT missing required field: sub');
      throw new UnauthorizedException('Invalid token: missing user ID');
    }

    if (!payload.role) {
      this.logger.warn(`JWT missing role for user ${payload.sub}`);
      throw new UnauthorizedException('Invalid token: missing role');
    }

    // Validate role is a known role
    if (!Object.values(Role).includes(payload.role)) {
      this.logger.warn(`JWT contains invalid role: ${payload.role}`);
      throw new UnauthorizedException('Invalid token: invalid role');
    }

    // Resolve permissions from role + any direct permissions
    const rolePermissions = ROLE_PERMISSIONS[payload.role] || [];
    const directPermissions = payload.permissions || [];
    const allPermissions = [...new Set([...rolePermissions, ...directPermissions])];

    // Set user context for logging (Story 1.7 requirement)
    setUserContext(payload.sub, payload.role);

    this.logger.log(`User ${payload.sub} authenticated with role ${payload.role}`, {
      userId: payload.sub,
      role: payload.role,
      permissionCount: allPermissions.length,
    });

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      permissions: allPermissions,
    };
  }
}
