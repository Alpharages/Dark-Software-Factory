import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from '../services/approval.service';
import { ApprovalDecision } from '@/prisma/client';
import { ApprovalActionDto } from '../dto/approval.dto';

describe('ApprovalController', () => {
    let controller: ApprovalController;
    let service: ApprovalService;

    const mockService = {
        approve: jest.fn(),
        reject: jest.fn(),
        rework: jest.fn(),
        escalate: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [ApprovalController],
            providers: [
                { provide: ApprovalService, useValue: mockService },
            ],
        }).compile();

        controller = module.get<ApprovalController>(ApprovalController);
        service = module.get<ApprovalService>(ApprovalService);
    });

    describe('handleApproval', () => {
        const executionId = 'exec-1';
        const pmId = 'pm-1';
        const user = { sub: pmId };

        it('should call approve on service', async () => {
            const dto: ApprovalActionDto = { decision: ApprovalDecision.APPROVE, reasoning: 'LGTM' };
            await controller.handleApproval(executionId, dto, { user });
            expect(service.approve).toHaveBeenCalledWith(executionId, pmId, dto.reasoning);
        });

        it('should call reject on service', async () => {
            const dto: ApprovalActionDto = { decision: ApprovalDecision.REJECT, reasoning: 'Bad code' };
            await controller.handleApproval(executionId, dto, { user });
            expect(service.reject).toHaveBeenCalledWith(executionId, pmId, dto.reasoning);
        });

        it('should call rework on service', async () => {
            const dto: ApprovalActionDto = { decision: ApprovalDecision.REWORK, reasoning: 'Fix spelling' };
            await controller.handleApproval(executionId, dto, { user });
            expect(service.rework).toHaveBeenCalledWith(executionId, pmId, dto.reasoning);
        });

        it('should call escalate on service', async () => {
            const dto: ApprovalActionDto = { decision: ApprovalDecision.ESCALATE, reasoning: 'Unsure' };
            await controller.handleApproval(executionId, dto, { user });
            expect(service.escalate).toHaveBeenCalledWith(executionId, pmId, dto.reasoning);
        });
    });
});
