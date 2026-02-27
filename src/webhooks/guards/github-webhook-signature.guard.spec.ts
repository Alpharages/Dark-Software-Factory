import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { GitHubWebhookSignatureGuard } from './github-webhook-signature.guard';

describe('GitHubWebhookSignatureGuard', () => {
  let guard: GitHubWebhookSignatureGuard;
  let _configService: ConfigService;

  const mockSecret = 'test-secret';
  const mockPayload = Buffer.from(JSON.stringify({ action: 'test' }));

  const generateSignature = (payload: Buffer, secret: string) => {
    const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `sha256=${hash}`;
  };

  const createMockContext = (
    headers: Record<string, string>,
    rawBody?: Buffer,
  ): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          rawBody,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('when secret is configured', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GitHubWebhookSignatureGuard,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockImplementation((key) => {
                if (key === 'github.webhookSecret') return mockSecret;
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      guard = module.get<GitHubWebhookSignatureGuard>(GitHubWebhookSignatureGuard);
      _configService = module.get<ConfigService>(ConfigService);
    });

    it('should be defined', () => {
      expect(guard).toBeDefined();
    });

    it('should return true for valid signature', async () => {
      const signature = generateSignature(mockPayload, mockSecret);
      const ctx = createMockContext({ 'x-hub-signature-256': signature }, mockPayload);

      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('should throw UnauthorizedException for invalid signature', async () => {
      const wrongSignature = generateSignature(mockPayload, 'wrong-secret');
      const ctx = createMockContext({ 'x-hub-signature-256': wrongSignature }, mockPayload);

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if signature header is missing', async () => {
      const ctx = createMockContext({}, mockPayload);

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if rawBody is missing', async () => {
      const signature = generateSignature(mockPayload, mockSecret);
      const ctx = createMockContext({ 'x-hub-signature-256': signature }, undefined);

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    describe('malformed signature header values', () => {
      it('should reject a sha1 prefixed signature (wrong algorithm)', async () => {
        const sha1Hash = crypto.createHmac('sha1', mockSecret).update(mockPayload).digest('hex');
        const ctx = createMockContext({ 'x-hub-signature-256': `sha1=${sha1Hash}` }, mockPayload);

        await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      });

      it('should reject a signature with an empty hex portion (sha256=)', async () => {
        const ctx = createMockContext({ 'x-hub-signature-256': 'sha256=' }, mockPayload);

        await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      });

      it('should reject a signature with no "=" separator', async () => {
        const ctx = createMockContext({ 'x-hub-signature-256': 'notvalid' }, mockPayload);

        await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      });

      it('should reject a signature with non-hex characters', async () => {
        const ctx = createMockContext({ 'x-hub-signature-256': 'sha256=xyz!notahex' }, mockPayload);

        await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      });
    });
  });

  describe('when secret is NOT configured', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GitHubWebhookSignatureGuard,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(''),
            },
          },
        ],
      }).compile();

      guard = module.get<GitHubWebhookSignatureGuard>(GitHubWebhookSignatureGuard);
    });

    it('should return true and bypass verification', async () => {
      // Even with no header or body, it should just pass and log a warning
      const ctx = createMockContext({}, undefined);

      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });
  });
});
