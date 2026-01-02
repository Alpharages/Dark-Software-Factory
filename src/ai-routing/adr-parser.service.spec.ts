import { Test, TestingModule } from '@nestjs/testing';
import { AdrParserService } from './adr-parser.service';

describe('AdrParserService', () => {
  let service: AdrParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdrParserService],
    }).compile();

    service = module.get<AdrParserService>(AdrParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('parseAdrFromResponse', () => {
    it('should parse valid ADR JSON from code fence', () => {
      const response = `Some AI response text
\`\`\`json
{
  "adr": {
    "title": "Use Redis for Caching",
    "context": "Need faster data access",
    "decision": "Implemented Redis caching layer",
    "consequences": "Faster reads, added dependency",
    "alternatives": "Memcached, in-memory cache",
    "ai_confidence": 0.85,
    "risk_level": "HIGH"
  }
}
\`\`\`
More text`;

      const result = service.parseAdrFromResponse(response, 'exec-123', 'ticket-456');

      expect(result).toEqual({
        execution_id: 'exec-123',
        ticket_id: 'ticket-456',
        title: 'Use Redis for Caching',
        context: 'Need faster data access',
        decision: 'Implemented Redis caching layer',
        consequences: 'Faster reads, added dependency',
        alternatives: 'Memcached, in-memory cache',
        ai_confidence: 0.85,
        risk_level: 'HIGH',
      });
    });

    it('should parse ADR without code fence', () => {
      const response = `{"adr": {"title": "Test ADR", "context": "Test context", "decision": "Test decision", "consequences": "Test consequences"}}`;

      const result = service.parseAdrFromResponse(response);

      expect(result).toBeTruthy();
      expect(result?.title).toBe('Test ADR');
    });

    it('should return null if no ADR found', () => {
      const response = 'Just some regular AI response without ADR';

      const result = service.parseAdrFromResponse(response);

      expect(result).toBeNull();
    });

    it('should return null if ADR missing required fields', () => {
      const response = `\`\`\`json
{
  "adr": {
    "title": "Incomplete ADR"
  }
}
\`\`\``;

      const result = service.parseAdrFromResponse(response);

      expect(result).toBeNull();
    });

    it('should handle invalid JSON gracefully', () => {
      const response = `\`\`\`json
{
  "adr": {
    "title": "Bad JSON",
    invalid json here
  }
}
\`\`\``;

      const result = service.parseAdrFromResponse(response);

      expect(result).toBeNull();
    });

    it('should normalize risk level to uppercase', () => {
      const response = `{"adr": {"title": "Test", "context": "Test", "decision": "Test", "consequences": "Test", "risk_level": "medium"}}`;

      const result = service.parseAdrFromResponse(response);

      expect(result?.risk_level).toBe('MEDIUM');
    });

    it('should parse confidence as number', () => {
      const response = `{"adr": {"title": "Test", "context": "Test", "decision": "Test", "consequences": "Test", "ai_confidence": "0.75"}}`;

      const result = service.parseAdrFromResponse(response);

      expect(result?.ai_confidence).toBe(0.75);
    });

    it('should return undefined for invalid confidence', () => {
      const response = `{"adr": {"title": "Test", "context": "Test", "decision": "Test", "consequences": "Test", "ai_confidence": 1.5}}`;

      const result = service.parseAdrFromResponse(response);

      expect(result?.ai_confidence).toBeUndefined();
    });
  });

  describe('hasAdr', () => {
    it('should detect ADR with code fence', () => {
      const response = '```json\\n{"adr": {...}}\\n```';

      expect(service.hasAdr(response)).toBe(true);
    });

    it('should detect ADR without code fence', () => {
      const response = '{"adr": {...}}';

      expect(service.hasAdr(response)).toBe(true);
    });

    it('should return false for empty response', () => {
      expect(service.hasAdr('')).toBe(false);
    });

    it('should return false when no ADR present', () => {
      expect(service.hasAdr('regular response text')).toBe(false);
    });
  });
});
