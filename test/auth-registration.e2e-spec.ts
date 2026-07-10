import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { InvitationsController } from '../src/auth/invitations/invitations.controller';
import { InvitationsService } from '../src/auth/invitations/invitations.service';
import { RegistrationController } from '../src/auth/registration/registration.controller';
import { RegistrationService } from '../src/auth/registration/registration.service';
import { JwtAuthGuard } from '../src/common/guards/auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { Role } from '../src/auth/constants/roles.enum';

describe('Invite registration flow (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RegistrationController, InvitationsController],
      providers: [
        { provide: RegistrationService, useValue: { register: jest.fn() } },
        { provide: InvitationsService, useValue: { verifyToken: jest.fn() } },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        RolesGuard,
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    jest
      .spyOn(module.get(InvitationsService), 'verifyToken')
      .mockResolvedValue({ email: 'new-user@example.com', role: Role.PM, expiresAt: new Date() });
    jest.spyOn(module.get(RegistrationService), 'register').mockResolvedValue({
      accessToken: 'test-token',
      user: {
        id: 'user-id',
        email: 'new-user@example.com',
        fullName: 'New User',
        role: Role.PM,
        isActive: true,
      },
    });
  });

  afterAll(() => app.close());

  it('allows an unauthenticated user to verify an invite', () =>
    request(app.getHttpServer())
      .get('/api/v1/auth/invitations/verify/valid-token')
      .expect(200)
      .expect(({ body }) => expect(body.email).toBe('new-user@example.com')));

  it('allows an unauthenticated user to register with an invite', () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ inviteToken: 'valid-token', password: 'SecureP@ss123', fullName: 'New User' })
      .expect(201)
      .expect(({ body }) => expect(body.accessToken).toBe('test-token')));
});
