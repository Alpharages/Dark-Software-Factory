import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalDecision } from '@/prisma/client';
import { Role } from '@/auth/constants/roles.enum';
import { AuthenticatedUser } from '@/auth/interfaces/jwt-payload.interface';
import { RolesGuard } from '@/common/guards';
import { ApprovalGateController } from './approval-gate.controller';
import { ApprovalGateService } from './approval-gate.service';

describe('ApprovalGateController', () => {
  let controller: ApprovalGateController;
  let service: { recordDecision: jest.Mock; pendingApprovals: jest.Mock };

  const approver = (role: Role): AuthenticatedUser => ({
    id: 'pm-1',
    email: 'pm@example.com',
    name: 'PM One',
    role,
    permissions: [],
  });

  beforeEach(async () => {
    service = {
      recordDecision: jest.fn().mockResolvedValue({ status: 'COMPLETED' }),
      pendingApprovals: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApprovalGateController],
      providers: [{ provide: ApprovalGateService, useValue: service }],
    }).compile();

    controller = module.get<ApprovalGateController>(ApprovalGateController);
  });

  describe('recordDecision routing + attribution (AC3/AC4/AC7)', () => {
    it.each([ApprovalDecision.APPROVE, ApprovalDecision.REJECT, ApprovalDecision.REWORK])(
      'forwards a %s decision with the authenticated user id as decider',
      async (decision) => {
        await controller.recordDecision(
          'exec-1',
          { decision, reasoning: 'why' },
          { user: approver(Role.PM) },
        );

        expect(service.recordDecision).toHaveBeenCalledWith({
          executionId: 'exec-1',
          deciderId: 'pm-1',
          decision,
          reasoning: 'why',
        });
      },
    );

    it('fails closed when no authenticated user id resolves (AC7 / NFR-S5)', () => {
      expect(() =>
        controller.recordDecision(
          'exec-1',
          { decision: ApprovalDecision.APPROVE },
          { user: undefined },
        ),
      ).toThrow(UnauthorizedException);
      expect(service.recordDecision).not.toHaveBeenCalled();
    });
  });

  describe('pendingApprovals (AC5)', () => {
    it('scopes the pending list to the supplied project id', async () => {
      await controller.pendingApprovals('project-1');
      expect(service.pendingApprovals).toHaveBeenCalledWith('project-1');
    });

    it('lists all tenants when no project id is supplied', async () => {
      await controller.pendingApprovals();
      expect(service.pendingApprovals).toHaveBeenCalledWith(undefined);
    });
  });

  // Exercises the RolesGuard against the controller's own @Roles metadata so the
  // approver allow-list is enforced in a test, not just by convention (AC7).
  describe('role enforcement (AC7)', () => {
    const guard = new RolesGuard(new Reflector());

    const contextFor = (handler: string, user?: AuthenticatedUser): ExecutionContext =>
      ({
        getHandler: () => ApprovalGateController.prototype[handler as 'recordDecision'],
        getClass: () => ApprovalGateController,
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as unknown as ExecutionContext;

    it.each([Role.ADMIN, Role.MANAGER, Role.PM, Role.TL])(
      'allows approver role %s to record a decision',
      (role) => {
        expect(guard.canActivate(contextFor('recordDecision', approver(role)))).toBe(true);
      },
    );

    it.each([Role.QA, Role.VIEWER])('refuses non-approver role %s', (role) => {
      expect(() => guard.canActivate(contextFor('recordDecision', approver(role)))).toThrow(
        ForbiddenException,
      );
      expect(service.recordDecision).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated caller', () => {
      expect(() => guard.canActivate(contextFor('recordDecision', undefined))).toThrow(
        ForbiddenException,
      );
    });
  });
});
