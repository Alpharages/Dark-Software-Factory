import {
  Injectable,
  Logger,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { InvitationsService } from '../invitations/invitations.service';
import { RegisterUserDto } from '../dto/register-user.dto';
import { RegisterResponseDto } from '../dto/register-response.dto';
import { UserDto } from '../dto/user.dto';
import { InvitationStatus } from '../../prisma/enums';
import { Role } from '../constants/roles.enum';

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private prisma: PrismaService,
    private invitationsService: InvitationsService,
    private jwtService: JwtService,
  ) {}

  /**
   * Register a new user via invite token
   */
  async register(dto: RegisterUserDto): Promise<RegisterResponseDto> {
    try {
      // Step 1: Validate invite token (throws if invalid)
      this.logger.debug(`Verifying invitation token: ${dto.inviteToken.substring(0, 8)}...`);
      const invitation = await this.invitationsService.verifyToken(dto.inviteToken);

      // Step 2: Check if user with invitation email already exists
      this.logger.debug(`Checking if user exists with email: ${invitation.email}`);
      const existingUser = await this.prisma.user.findUnique({
        where: { email: invitation.email },
      });

      if (existingUser) {
        this.logger.warn(`User already exists with email: ${invitation.email}`);
        throw new ConflictException('User already exists with this email');
      }

      // Step 3: Hash password
      this.logger.debug('Hashing password with bcrypt cost factor 12');
      const passwordHash = await bcrypt.hash(dto.password, 12);

      // Step 4: Execute atomic transaction to create user and mark invitation accepted
      this.logger.debug('Executing transaction: create user + update invitation');
      const user = await this.prisma.$transaction(async (tx) => {
        // Generate UUID for user
        const userId = crypto.randomUUID();

        // Create user
        const newUser = await tx.user.create({
          data: {
            id: userId,
            email: invitation.email,
            password_hash: passwordHash,
            full_name: dto.fullName,
            role: invitation.role as string,
            is_active: true,
            last_login_at: null,
          },
        });

        // Update invitation status to ACCEPTED
        await tx.userInvitation.update({
          where: { invite_token: dto.inviteToken },
          data: {
            status: InvitationStatus.ACCEPTED,
            accepted_at: new Date(),
          },
        });

        return newUser;
      });

      this.logger.log(`User registered successfully: ${user.id} (${user.email})`);

      // Step 5: Generate JWT token
      this.logger.debug('Generating JWT access token');
      const accessToken = this.jwtService.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      // Step 6: Return response (exclude password_hash)
      const userDto: UserDto = {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role as Role,
        isActive: user.is_active,
      };

      return {
        accessToken,
        user: userDto,
      };
    } catch (error) {
      // Let InvitationsService errors propagate (404, 400, 410, 403)
      if (error instanceof ConflictException) {
        throw error;
      }

      // Catch and rethrow known HTTP exceptions
      if (error && typeof error === 'object' && 'status' in error) {
        throw error;
      }

      // Log database errors and throw generic error
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      const errorStack =
        error && typeof error === 'object' && 'stack' in error ? (error as Error).stack : undefined;
      this.logger.error(`Registration failed with unexpected error: ${errorMessage}`, errorStack);
      throw new InternalServerErrorException('Registration failed. Please try again later.');
    }
  }
}
