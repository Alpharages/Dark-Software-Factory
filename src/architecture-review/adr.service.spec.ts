import { Test, TestingModule } from '@nestjs/testing';
import { AdrService } from './adr.service';
import { PrismaService } from '../database/prisma.service';
import { CreateAdrDto } from './dto';

describe('AdrService', () => {
    let service: AdrService;
    let prismaService: PrismaService;

    const mockPrismaService = {
        adr: {
            create: jest.fn(),
            findMany: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AdrService,
                {
                    provide: PrismaService,
                    useValue: mockPrismaService,
                },
            ],
        }).compile();

        service = module.get<AdrService>(AdrService);
        prismaService = module.get<PrismaService>(PrismaService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        it('should create an ADR with calculated risk level', async () => {
            const createDto: CreateAdrDto = {
                title: 'Use Redis for Session Storage',
                context: 'We need a fast session store',
                decision: 'Add Redis dependency',
                consequences: 'Faster sessions, new dependency',
            };

            const expectedAdr = {
                id: '123',
                ...createDto,
                risk_level: 'HIGH',
                status: 'PROPOSED',
                created_at: new Date(),
                updated_at: new Date(),
            };

            mockPrismaService.adr.create.mockResolvedValue(expectedAdr);

            const result = await service.create(createDto);

            expect(result).toEqual(expectedAdr);
            expect(mockPrismaService.adr.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    title: createDto.title,
                    context: createDto.context,
                    decision: createDto.decision,
                    consequences: createDto.consequences,
                    risk_level: 'HIGH',
                    status: 'PROPOSED',
                }),
            });
        });

        it('should use provided risk level if specified', async () => {
            const createDto: CreateAdrDto = {
                title: 'Simple refactor',
                context: 'Clean up code',
                decision: 'Refactor module',
                consequences: 'Better code quality',
                risk_level: 'LOW',
            };

            const expectedAdr = {
                id: '456',
                ...createDto,
                status: 'PROPOSED',
                created_at: new Date(),
                updated_at: new Date(),
            };

            mockPrismaService.adr.create.mockResolvedValue(expectedAdr);

            await service.create(createDto);

            expect(mockPrismaService.adr.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    risk_level: 'LOW',
                }),
            });
        });
    });

    describe('calculateRiskLevel', () => {
        it('should return HIGH for new dependencies', () => {
            const dto: CreateAdrDto = {
                title: 'Add New Dependency',
                context: 'We need a new library',
                decision: 'Add new dependency',
                consequences: 'Functionality added',
            };

            const result = service.calculateRiskLevel(dto);
            expect(result).toBe('HIGH');
        });

        it('should return HIGH for schema changes', () => {
            const dto: CreateAdrDto = {
                title: 'Update Database Schema',
                context: 'Need to add new fields',
                decision: 'Schema changes required',
                consequences: 'New fields available',
            };

            const result = service.calculateRiskLevel(dto);
            expect(result).toBe('HIGH');
        });

        it('should return MEDIUM for refactoring', () => {
            const dto: CreateAdrDto = {
                title: 'Refactor Module',
                context: 'Code needs cleanup',
                decision: 'Refactoring the module',
                consequences: 'Better code quality',
            };

            const result = service.calculateRiskLevel(dto);
            expect(result).toBe('MEDIUM');
        });

        it('should return LOW for minor changes', () => {
            const dto: CreateAdrDto = {
                title: 'Update Documentation',
                context: 'Docs are outdated',
                decision: 'Update docs',
                consequences: 'Better docs',
            };

            const result = service.calculateRiskLevel(dto);
            expect(result).toBe('LOW');
        });
    });

    describe('findAll', () => {
        it('should return all ADRs with relations', async () => {
            const mockAdrs = [
                {
                    id: '1',
                    title: 'ADR 1',
                    execution: { id: 'exec1' },
                    ticket: { id: 'ticket1' },
                },
            ];

            mockPrismaService.adr.findMany.mockResolvedValue(mockAdrs);

            const result = await service.findAll();

            expect(result).toEqual(mockAdrs);
            expect(mockPrismaService.adr.findMany).toHaveBeenCalledWith({
                where: undefined,
                include: {
                    execution: true,
                    ticket: true,
                },
                orderBy: {
                    created_at: 'desc',
                },
            });
        });

        it('should filter ADRs by where clause', async () => {
            const whereClause: any = { status: "PROPOSED" };
            mockPrismaService.adr.findMany.mockResolvedValue([]);

            await service.findAll(whereClause);

            expect(mockPrismaService.adr.findMany).toHaveBeenCalledWith({
                where: whereClause,
                include: {
                    execution: true,
                    ticket: true,
                },
                orderBy: {
                    created_at: 'desc',
                },
            });
        });
    });

    describe('findOne', () => {
        it('should return a single ADR by ID', async () => {
            const mockAdr = {
                id: '123',
                title: 'Test ADR',
                execution: null,
                ticket: null,
            };

            mockPrismaService.adr.findUnique.mockResolvedValue(mockAdr);

            const result = await service.findOne('123');

            expect(result).toEqual(mockAdr);
            expect(mockPrismaService.adr.findUnique).toHaveBeenCalledWith({
                where: { id: '123' },
                include: {
                    execution: true,
                    ticket: true,
                },
            });
        });
    });

    describe('update', () => {
        it('should update an ADR', async () => {
            const updateDto = { status: 'ACCEPTED' };
            const mockUpdatedAdr = { id: '123', ...updateDto };

            mockPrismaService.adr.update.mockResolvedValue(mockUpdatedAdr);

            const result = await service.update('123', updateDto);

            expect(result).toEqual(mockUpdatedAdr);
            expect(mockPrismaService.adr.update).toHaveBeenCalledWith({
                where: { id: '123' },
                data: updateDto,
            });
        });
    });

    describe('remove', () => {
        it('should delete an ADR', async () => {
            const mockDeletedAdr = { id: '123' };

            mockPrismaService.adr.delete.mockResolvedValue(mockDeletedAdr);

            const result = await service.remove('123');

            expect(result).toEqual(mockDeletedAdr);
            expect(mockPrismaService.adr.delete).toHaveBeenCalledWith({
                where: { id: '123' },
            });
        });
    });

    describe('findByExecution', () => {
        it('should find ADRs by execution ID', async () => {
            const execId = 'exec-123';
            const mockAdrs = [{ id: '1', execution_id: execId }];

            mockPrismaService.adr.findMany.mockResolvedValue(mockAdrs);

            await service.findByExecution(execId);

            expect(mockPrismaService.adr.findMany).toHaveBeenCalledWith({
                where: { execution_id: execId },
                include: {
                    execution: true,
                    ticket: true,
                },
                orderBy: {
                    created_at: 'desc',
                },
            });
        });
    });

    describe('findByTicket', () => {
        it('should find ADRs by ticket ID', async () => {
            const ticketId = 'ticket-123';
            const mockAdrs = [{ id: '1', ticket_id: ticketId }];

            mockPrismaService.adr.findMany.mockResolvedValue(mockAdrs);

            await service.findByTicket(ticketId);

            expect(mockPrismaService.adr.findMany).toHaveBeenCalledWith({
                where: { ticket_id: ticketId },
                include: {
                    execution: true,
                    ticket: true,
                },
                orderBy: {
                    created_at: 'desc',
                },
            });
        });
    });
});
