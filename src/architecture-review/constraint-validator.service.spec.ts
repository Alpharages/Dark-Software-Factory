import { Test, TestingModule } from '@nestjs/testing';
import { ConstraintValidatorService } from './constraint-validator.service';
import { ArchitectureConstraintsService } from './architecture-constraints.service';

describe('ConstraintValidatorService', () => {
  let service: ConstraintValidatorService;
  let _constraintsService: ArchitectureConstraintsService;

  const mockConstraintsService = {
    findAll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConstraintValidatorService,
        { provide: ArchitectureConstraintsService, useValue: mockConstraintsService },
      ],
    }).compile();

    service = module.get<ConstraintValidatorService>(ConstraintValidatorService);
    _constraintsService = module.get<ArchitectureConstraintsService>(
      ArchitectureConstraintsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validate', () => {
    it('should return violations for forbidden tech', async () => {
      const forbiddenConstraint = {
        id: '1',
        scope: 'GLOBAL',
        type: 'FORBIDDEN_TECH',
        rules: { items: ['bad-lib'], reason: 'Security risk' },
      };
      mockConstraintsService.findAll.mockResolvedValue([forbiddenConstraint]);

      const files = [
        {
          path: 'package.json',
          content: JSON.stringify({ dependencies: { 'bad-lib': '1.0.0' } }),
        },
      ];

      const violations = await service.validate({ files });
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('Forbidden dependency found: bad-lib');
    });

    it('should not return violations if package.json is safe', async () => {
      const forbiddenConstraint = {
        id: '1',
        scope: 'GLOBAL',
        type: 'FORBIDDEN_TECH',
        rules: { items: ['bad-lib'] },
      };
      mockConstraintsService.findAll.mockResolvedValue([forbiddenConstraint]);

      const files = [
        {
          path: 'package.json',
          content: JSON.stringify({ dependencies: { 'good-lib': '1.0.0' } }),
        },
      ];

      const violations = await service.validate({ files });
      expect(violations).toHaveLength(0);
    });
  });
});
