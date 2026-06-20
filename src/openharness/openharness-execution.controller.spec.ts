import { InternalServerErrorException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { ExecutionStatus } from '@/prisma/client';
import { ExecutionRepository } from '@/execution/execution.repository';
import { OpenHarnessExecutionController } from './openharness-execution.controller';
import { OpenHarnessRunnerService } from './openharness-runner.service';
import { TestExecutionDto } from './dto/test-execution.dto';

describe('OpenHarnessExecutionController', () => {
  let controller: OpenHarnessExecutionController;
  let runner: jest.Mocked<Pick<OpenHarnessRunnerService, 'runForTicket'>>;
  let executionRepository: jest.Mocked<Pick<ExecutionRepository, 'findById'>>;
  let configService: { get: jest.Mock<unknown, [string]> };

  beforeEach(async () => {
    runner = {
      runForTicket: jest.fn().mockResolvedValue('exec-123'),
    };
    executionRepository = {
      findById: jest.fn().mockResolvedValue({
        id: 'exec-123',
        status: ExecutionStatus.COMPLETED,
        code_output: 'Implemented the ticket',
        files_changed: ['src/openharness/openharness-execution.controller.ts'],
      }),
    };
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string | number> = {
          'openharness.defaultSkill': 'clickup-dev-implement',
          'openharness.workspaceDir': '/workspaces/dsf',
          'openharness.maxTurns': 200,
          'openharness.mcpConfigPath': 'docs/openharness/mcp-config.json',
        };
        return values[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OpenHarnessExecutionController],
      providers: [
        { provide: OpenHarnessRunnerService, useValue: runner },
        { provide: ExecutionRepository, useValue: executionRepository },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get(OpenHarnessExecutionController);
  });

  it('merges request overrides over ConfigService defaults and returns a visible execution result', async () => {
    const result = await controller.runTestExecution({
      ticketId: '86ey08c75',
      skill: 'custom-skill',
      maxTurns: 50,
    });

    expect(runner.runForTicket).toHaveBeenCalledWith('86ey08c75', {
      skill: 'custom-skill',
      workspaceDir: '/workspaces/dsf',
      maxTurns: 50,
      mcpConfigPath: 'docs/openharness/mcp-config.json',
    });
    expect(executionRepository.findById).toHaveBeenCalledWith('exec-123');
    expect(result).toEqual({
      executionId: 'exec-123',
      status: ExecutionStatus.COMPLETED,
      summary: 'Implemented the ticket',
      filesChanged: ['src/openharness/openharness-execution.controller.ts'],
      pollUrl: '/api/v1/executions/exec-123/status',
      streamUrl: 'socket.io:/execution?room=execution_logs_exec-123',
    });
  });

  it('validates ticketId as required', async () => {
    const dto = new TestExecutionDto();
    dto.skill = 'clickup-dev-implement';

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'ticketId')).toBe(true);
  });

  it('transforms maxTurns through the validation pipe and rejects invalid bounds', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    const transformed = await pipe.transform(
      { ticketId: '86ey08c75', maxTurns: '25' },
      { type: 'body', metatype: TestExecutionDto },
    );

    expect(transformed.maxTurns).toBe(25);
    await expect(
      pipe.transform(
        { ticketId: '86ey08c75', maxTurns: 0 },
        { type: 'body', metatype: TestExecutionDto },
      ),
    ).rejects.toThrow();
  });

  it('returns a structured error when the runner throws', async () => {
    runner.runForTicket.mockRejectedValueOnce(new Error('oh failed'));

    await expect(controller.runTestExecution({ ticketId: '86ey08c75' })).rejects.toMatchObject({
      constructor: InternalServerErrorException,
      response: {
        message: 'OpenHarness test execution failed',
        ticketId: '86ey08c75',
        error: 'oh failed',
      },
    });
  });
});
