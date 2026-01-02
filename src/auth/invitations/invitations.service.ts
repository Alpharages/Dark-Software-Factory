import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { ListInvitationsQueryDto } from './dto/list-invitations-query.dto';
import { InvitationStatus } from '../../prisma/enums';
import { Role } from '../constants/roles.enum';
import * as crypto from 'crypto';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  /**
   * Create a new user invitation
   */
  async createInvitation(invitedById: string, dto: CreateInvitationDto) {
    // Check for existing pending invitation
    const existingInvitation = await this.prisma.userInvitation.findFirst({
      where: {
        email: dto.email,
        status: InvitationStatus.PENDING,
      },
    });

    if (existingInvitation) {
      throw new ConflictException('Pending invitation already exists for this email');
    }

    // Check if user already exists (accepted invitation)
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('User already registered with this email');
    }

    // Generate token
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create invitation
    const invitation = await this.prisma.userInvitation.create({
      data: {
        email: dto.email,
        role: dto.role,
        invite_token: inviteToken,
        invited_by_id: invitedById,
        expires_at: expiresAt,
        status: InvitationStatus.PENDING,
      },
      include: {
        invited_by: {
          select: {
            id: true,
            full_name: true,
            email: true,
          },
        },
      },
    });

    // Send email (fire and forget / handled inside service)
    await this.emailService.sendInvitationEmail(invitation, invitation.invited_by.full_name);

    return invitation;
  }

  /**
   * List all invitations with pagination and filtering
   */
  async listInvitations(query: ListInvitationsQueryDto) {
    const { page = 1, limit = 50, status } = query;
    const skip = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (status) {
      where.status = status;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.userInvitation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          invited_by: {
            select: {
              id: true,
              full_name: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.userInvitation.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Revoke an invitation
   */
  async revokeInvitation(id: string) {
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { id },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException('Cannot revoke an already accepted invitation');
    }

    // Revoking an already expired or revoked invitation is idempotent-ish,
    // but the AC says "Prevents revocation of already accepted".
    // It implies we should allow revoking PENDING.
    // If it's EXPIRED, revoking it further just marks it as REVOKED which is fine.

    return this.prisma.userInvitation.update({
      where: { id },
      data: { status: InvitationStatus.REVOKED },
    });
  }

  /**
   * Verify an invitation token
   */
  async verifyToken(token: string) {
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { invite_token: token },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation token not found');
    }

    if (invitation.status === InvitationStatus.REVOKED) {
      throw new ForbiddenException('Invitation has been revoked');
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException('Invitation has already been accepted');
    }

    if (invitation.expires_at < new Date()) {
      // Return 410 Gone for expired tokens
      throw new HttpException('Invitation has expired', HttpStatus.GONE);
    }

    // Also check status specifically for EXPIRED enum if set manually
    if (invitation.status === InvitationStatus.EXPIRED) {
      throw new HttpException('Invitation has expired', HttpStatus.GONE);
    }

    return {
      email: invitation.email,
      role: invitation.role as Role,
      expiresAt: invitation.expires_at,
    };
  }
}
