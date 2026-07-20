import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/database/prisma.service';
import { RegistrationModule } from './registration.module';
import configuration from '@/config/configuration';

/**
 * REG-CRIT regression guard.
 *
 * RegistrationModule used to import the bare `JwtModule` with the comment
 * "Already configured in AuthModule". Nest module config is not global, so it
 * received a JwtService with NO secret: `sign()` threw
 * `secretOrPrivateKey must have a value` — and because that call happens AFTER
 * the user+invitation transaction commits, the account and the consumed invite
 * were already durable. The invitee was permanently locked out (500 on
 * register, "Invitation has already been accepted" on retry).
 *
 * This must resolve the REAL JwtService from the REAL module graph.
 * `registration.service.spec.ts` injects a mock JwtService, which is exactly
 * why every unit test passed while registration was broken in production.
 */
describe('RegistrationModule (wiring)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'test-jwt-secret-at-least-32-characters-long!!';

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        RegistrationModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('provides a JwtService that can actually sign (secret is wired)', () => {
    const jwtService = moduleRef.get(JwtService, { strict: false });

    // The exact call registration.service.ts makes after the transaction commits.
    expect(() =>
      jwtService.sign({ sub: 'user-id', email: 'a@b.com', role: 'VIEWER' }),
    ).not.toThrow();

    const token = jwtService.sign({ sub: 'user-id', email: 'a@b.com', role: 'VIEWER' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('signs a verifiable token with the configured secret', () => {
    const jwtService = moduleRef.get(JwtService, { strict: false });
    const token = jwtService.sign({ sub: 'user-id', email: 'a@b.com', role: 'VIEWER' });

    const decoded = jwtService.verify<{ sub: string; role: string }>(token, {
      secret: process.env.JWT_SECRET,
    });
    expect(decoded.sub).toBe('user-id');
    expect(decoded.role).toBe('VIEWER');
  });
});
