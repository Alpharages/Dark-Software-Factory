import { Injectable, Logger } from '@nestjs/common';
import { CreateAdrDto } from '../architecture-review/dto';

/**
 * ADR Parser Service
 * 
 * Extracts Architecture Decision Records from AI responses
 * Follows Story 7.1 AC#1 and AC#5: Parse ADR JSON outputs from AI
 */
@Injectable()
export class AdrParserService {
    private readonly logger = new Logger(AdrParserService.name);

    /**
     * Parse ADR from AI response text
     * 
     * @param responseText - AI response that may contain ADR JSON
     * @param executionId - Execution ID for linking
     * @param ticketId - Ticket ID for linking
     * @returns Parsed ADR DTO or null if no ADR found
     */
    parseAdrFromResponse(
        responseText: string,
        executionId?: string,
        ticketId?: string,
    ): CreateAdrDto | null {
        if (!responseText) {
            return null;
        }

        try {
            // Look for ADR JSON in the response
            // Pattern: ```json\n{ "adr": { ... } }\n```
            const adrJsonMatch = responseText.match(
                /```json\s*\n?\s*{\s*"adr"\s*:\s*({[\s\S]*?})\s*}\s*\n?```/i,
            );

            if (!adrJsonMatch) {
                // Try alternate pattern without code fence
                const altMatch = responseText.match(/{\s*"adr"\s*:\s*({[\s\S]*?})\s*}/i);

                if (!altMatch) {
                    this.logger.debug('No ADR JSON found in AI response');
                    return null;
                }

                return this.extractAdrData(altMatch[1], executionId, ticketId);
            }

            const adrDataJson = adrJsonMatch[1];
            return this.extractAdrData(adrDataJson, executionId, ticketId);
        } catch (error) {
            const err = error as Error;
            this.logger.warn(`Failed to parse ADR from response: ${err.message}`);
            return null;
        }
    }

    /**
     * Extract and validate ADR data from JSON string
     */
    private extractAdrData(
        jsonString: string,
        executionId?: string,
        ticketId?: string,
    ): CreateAdrDto | null {
        try {
            const adrData = JSON.parse(jsonString);

            // Validate required fields
            if (!adrData.title || !adrData.context || !adrData.decision || !adrData.consequences) {
                this.logger.warn('ADR JSON missing required fields');
                return null;
            }

            const adrDto: CreateAdrDto = {
                execution_id: executionId,
                ticket_id: ticketId,
                title: String(adrData.title).trim(),
                context: String(adrData.context).trim(),
                decision: String(adrData.decision).trim(),
                consequences: String(adrData.consequences).trim(),
                alternatives: adrData.alternatives ? String(adrData.alternatives).trim() : undefined,
                ai_confidence: this.parseConfidence(adrData.ai_confidence),
                risk_level: this.parseRiskLevel(adrData.risk_level),
            };

            this.logger.log(`Successfully parsed ADR: ${adrDto.title}`);
            return adrDto;
        } catch (error) {
            const err = error as Error;
            this.logger.warn(`Failed to parse ADR data: ${err.message}`);
            return null;
        }
    }

    /**
     * Parse and validate AI confidence score
     */
    private parseConfidence(value: unknown): number | undefined {
        if (typeof value === 'number' && value >= 0 && value <= 1) {
            return value;
        }
        if (typeof value === 'string') {
            const parsed = parseFloat(value);
            if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
                return parsed;
            }
        }
        return undefined;
    }

    /**
     * Parse and validate risk level
     */
    private parseRiskLevel(value: unknown): string | undefined {
        if (typeof value === 'string') {
            const normalized = value.toUpperCase().trim();
            if (['LOW', 'MEDIUM', 'HIGH'].includes(normalized)) {
                return normalized;
            }
        }
        return undefined;
    }

    /**
     * Check if response contains an ADR
     */
    hasAdr(responseText: string): boolean {
        if (!responseText) {
            return false;
        }
        return (
            responseText.includes('"adr"') &&
            (responseText.includes('```json') || responseText.includes('{"adr"'))
        );
    }
}
