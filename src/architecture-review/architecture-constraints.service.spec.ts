import { Test, TestingModule } from '@nestjs/testing';
import { ArchitectureConstraintsService } from './architecture-constraints.service';
import { PrismaService } from '../database/prisma.service';

describe('ArchitectureConstraintsService', () => {
    let service: ArchitectureConstraintsService;
    let prisma: PrismaService;

    const mockPrismaService = {
        architectureConstraint: {
            create: jest.fn(),
            findMany: jest.fn(),
            findUniqueOrThrow: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ArchitectureConstraintsService,
                { provide: PrismaService, useValue: mockPrismaService },
            ],
        }).compile();

        service = module.get<ArchitectureConstraintsService>(ArchitectureConstraintsService);
        prisma = module.get<PrismaService>(PrismaService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        it('should create a constraint', async () => {
            const dto = { scope: 'GLOBAL', type: 'ALLOWED_TECH', rules: {} };
            const expected = { id: '1', ...dto, version: 1 };
            mockPrismaService.architectureConstraint.create.mockResolvedValue(expected);

            await expect(service.create(dto)).resolves.toEqual(expected);
            expect(prisma.architectureConstraint.create).toHaveBeenCalledWith({ data: dto });
        });
    });

    // Add more tests
});
