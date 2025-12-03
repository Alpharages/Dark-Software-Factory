import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

/**
 * Story 2.12: Context Extraction E2E Tests
 * FR3: PM can attach context documents (PDF, MD, TXT, DOCX)
 * FR59: System extracts project context for AI prompts
 *
 * Note: File upload tests require supertest with Express adapter.
 * This test file focuses on the GET/DELETE endpoints using Fastify inject.
 */
describe('Context Extraction (e2e)', () => {
  let app: NestFastifyApplication;
  let pmToken: string;
  let devToken: string;
  let prisma: PrismaService;
  let testTicketId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const jwtService = moduleFixture.get<JwtService>(JwtService);
    pmToken = jwtService.sign({ sub: 'pm-user-123', role: 'pm' });
    devToken = jwtService.sign({ sub: 'dev-user-123', role: 'developer' });

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Create test ticket
    const ticket = await prisma.ticket.create({
      data: {
        clickup_task_id: `test-task-${Date.now()}`,
        project_id: 'test-project',
        title: 'Test Ticket for Context Extraction',
        description: 'Test description for context document testing',
        acceptance_criteria: 'Test AC',
        ticket_quality_score: 75,
      },
    });
    testTicketId = ticket.id;
  });

  afterAll(async () => {
    // Cleanup test ticket and documents
    try {
      await prisma.contextDocument.deleteMany({
        where: { ticket_id: testTicketId },
      });
      await prisma.ticket.delete({ where: { id: testTicketId } });
    } catch {
      // Ignore cleanup errors
    }

    await app.close();
  });

  describe('GET /context-documents/ticket/:ticketId', () => {
    it('should return empty array for ticket without documents (PM)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/context-documents/ticket/${testTicketId}`,
        headers: {
          authorization: `Bearer ${pmToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body)).toBe(true);
    });

    it('should allow developer read access', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/context-documents/ticket/${testTicketId}`,
        headers: {
          authorization: `Bearer ${devToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it('should reject without authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/context-documents/ticket/${testTicketId}`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /context-documents/ticket/:ticketId/aggregated', () => {
    it('should return empty aggregated context for ticket without documents', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/context-documents/ticket/${testTicketId}/aggregated`,
        headers: {
          authorization: `Bearer ${pmToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('documents');
      expect(body).toHaveProperty('totalWordCount');
      expect(body).toHaveProperty('documentCount');
      expect(body).toHaveProperty('formattedContext');
      expect(body.documentCount).toBe(0);
      expect(body.formattedContext).toBe('');
    });

    it('should reject without authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/context-documents/ticket/${testTicketId}/aggregated`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /context-documents/:documentId', () => {
    it('should return 404 for non-existent document', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/context-documents/00000000-0000-0000-0000-000000000000',
        headers: {
          authorization: `Bearer ${pmToken}`,
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it('should reject without authentication', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/context-documents/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('Security Tests', () => {
    it('should require PM role for delete operations', async () => {
      // First create a document to ensure we're testing role access, not 404
      const doc = await prisma.contextDocument.create({
        data: {
          ticket_id: testTicketId,
          original_filename: 'test-security.md',
          file_format: 'MARKDOWN',
          file_size_bytes: 100,
          file_hash: `security-test-hash-${Date.now()}`,
          storage_path: '/tmp/test-security.md',
          extracted_text: 'Security test content',
          extraction_status: 'COMPLETED',
        },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/context-documents/${doc.id}`,
        headers: {
          authorization: `Bearer ${devToken}`,
        },
      });

      // Developer should get 403 Forbidden (role check fails before handler)
      expect(res.statusCode).toBe(403);

      // Cleanup
      await prisma.contextDocument.delete({ where: { id: doc.id } }).catch(() => {});
    });

    it('should allow PM to delete documents', async () => {
      const doc = await prisma.contextDocument.create({
        data: {
          ticket_id: testTicketId,
          original_filename: 'test-pm-delete.md',
          file_format: 'MARKDOWN',
          file_size_bytes: 100,
          file_hash: `pm-delete-hash-${Date.now()}`,
          storage_path: '/tmp/test-pm-delete.md',
          extracted_text: 'PM delete test content',
          extraction_status: 'COMPLETED',
        },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/context-documents/${doc.id}`,
        headers: {
          authorization: `Bearer ${pmToken}`,
        },
      });

      // PM should successfully delete (204 No Content)
      expect(res.statusCode).toBe(204);
    });
  });
});
