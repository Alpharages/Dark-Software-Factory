import { Test, TestingModule } from '@nestjs/testing';
import { RiskAssessmentService, RiskFactors } from './risk-assessment.service';
import { RiskLevel } from '@/prisma/client';

describe('RiskAssessmentService', () => {
    let service: RiskAssessmentService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [RiskAssessmentService],
        }).compile();

        service = module.get<RiskAssessmentService>(RiskAssessmentService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('calculateRiskLevel', () => {
        // HIGH RISK Scenarios
        it('should return HIGH risk for high domain complexity', () => {
            const factors: RiskFactors = {
                scope: 'module',
                reversibility: 'easy',
                confidence: 0.95,
                domain_complexity: 'high', // schema/security
            };
            expect(service.calculateRiskLevel(factors)).toBe(RiskLevel.HIGH);
        });

        it('should return HIGH risk for irreversible changes', () => {
            const factors: RiskFactors = {
                scope: 'module',
                reversibility: 'irreversible',
                confidence: 0.95,
                domain_complexity: 'medium',
            };
            expect(service.calculateRiskLevel(factors)).toBe(RiskLevel.HIGH);
        });

        it('should return HIGH risk for low confidence (< 0.7)', () => {
            const factors: RiskFactors = {
                scope: 'module',
                reversibility: 'easy',
                confidence: 0.65,
                domain_complexity: 'low',
            };
            expect(service.calculateRiskLevel(factors)).toBe(RiskLevel.HIGH);
        });

        // MEDIUM RISK Scenarios
        it('should return MEDIUM risk for cross-module scope', () => {
            const factors: RiskFactors = {
                scope: 'cross-module',
                reversibility: 'easy',
                confidence: 0.95,
                domain_complexity: 'medium',
            };
            expect(service.calculateRiskLevel(factors)).toBe(RiskLevel.MEDIUM);
        });

        it('should return MEDIUM risk for medium confidence (< 0.9)', () => {
            const factors: RiskFactors = {
                scope: 'module',
                reversibility: 'easy',
                confidence: 0.85,
                domain_complexity: 'low',
            };
            expect(service.calculateRiskLevel(factors)).toBe(RiskLevel.MEDIUM);
        });

        // LOW RISK Scenarios
        it('should return LOW risk for ideal conditions', () => {
            const factors: RiskFactors = {
                scope: 'single-file',
                reversibility: 'easy',
                confidence: 0.95,
                domain_complexity: 'low',
            };
            expect(service.calculateRiskLevel(factors)).toBe(RiskLevel.LOW);
        });
    });
});
