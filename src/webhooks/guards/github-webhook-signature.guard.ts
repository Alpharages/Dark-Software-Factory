import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { FastifyRequest } from 'fastify';

interface FastifyRequestWithRawBody extends FastifyRequest {
  rawBody?: Buffer;
}

/**
 * Guard to verify GitHub webhook signatures (X-Hub-Signature-256).
 *
 * Uses HMAC SHA-256 over the raw request body with GITHUB_WEBHOOK_SECRET.
 */
@Injectable()
export class GitHubWebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(GitHubWebhookSignatureGuard.name);
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.webhookSecret = this.configService.get<string>('github.webhookSecret') || '';

    if (!this.webhookSecret) {
      this.logger.warn(
        'GITHUB_WEBHOOK_SECRET is not configured — webhook HMAC validation is disabled',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.webhookSecret) {
      this.logger.debug(
        'Processing unverified webhook request — GITHUB_WEBHOOK_SECRET not configured',
      );
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequestWithRawBody>();

    const signature = request.headers['x-hub-signature-256'] as string | undefined;
    if (!signature) {
      this.logger.warn('GitHub webhook request missing x-hub-signature-256 header');
      throw new UnauthorizedException('Missing GitHub webhook signature');
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error('Raw body not available for GitHub signature verification');
      throw new UnauthorizedException('Unable to verify GitHub signature');
    }

    const isValid = this.verifySignature(rawBody, signature);
    if (!isValid) {
      this.logger.warn('Invalid GitHub webhook signature received');
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }

    return true;
  }

  private verifySignature(payload: Buffer, signatureHeader: string): boolean {
    try {
      // GitHub format: "sha256=<hex>"
      const [algo, signatureHex] = signatureHeader.split('=');
      if (algo !== 'sha256' || !signatureHex) return false;

      const digestHex = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      const a = Buffer.from(signatureHex, 'hex');
      const b = Buffer.from(digestHex, 'hex');
      if (a.length !== b.length) return false;

      return crypto.timingSafeEqual(a, b);
    } catch (_error) {
      this.logger.error(`GitHub signature verification error: ${(_error as Error).message}`);
      return false;
    }
  }
}
