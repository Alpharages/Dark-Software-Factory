import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../../auth/constants/roles.enum';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const mockExecutionContext = (user: { id: string; role: Role } | undefined): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const context = mockExecutionContext({ id: '1', role: Role.VIEWER });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user has required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.PM]);

    const context = mockExecutionContext({ id: '1', role: Role.PM });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow ADMIN access to any role-protected route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.QA]);

    const context = mockExecutionContext({ id: '1', role: Role.ADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user lacks required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    const context = mockExecutionContext({ id: '1', role: Role.VIEWER });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should throw when no user on request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.PM]);

    const context = mockExecutionContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
