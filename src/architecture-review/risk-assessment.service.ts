import { Injectable, Logger } from '@nestjs/common';
import { RiskLevel } from '@/prisma/client';

export interface RiskFactors {
    scope: 'single-file' | 'module' | 'cross-module';
    reversibility: 'easy' | 'migration-required' | 'irreversible';
    confidence: number; // 0.0 to 1.0
    domain_complexity: 'low' | 'medium' | 'high';
}

@Injectable()
export class RiskAssessmentService {
    private readonly logger = new Logger(RiskAssessmentService.name);

    calculateRiskLevel(factors: RiskFactors): RiskLevel {
        // High Risk Rules
        if (
            factors.domain_complexity === 'high' ||
            factors.reversibility === 'irreversible' ||
            factors.confidence < 0.7
        ) {
            return RiskLevel.HIGH;
        }

        // Medium Risk Rules
        if (
            factors.scope === 'cross-module' ||
            factors.confidence < 0.9
        ) {
            return RiskLevel.MEDIUM;
        }

        // Default Low
        return RiskLevel.LOW;
    }
}
