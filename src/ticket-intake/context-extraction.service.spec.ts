import { NotFoundException } from '@nestjs/common';
import { ContextExtractionService } from './context-extraction.service';
import { ContextCacheService } from './context-cache.service';
import { PrismaService } from '../database/prisma.service';
import { PdfExtractor, MarkdownExtractor, TextExtractor, DocxExtractor } from './extractors';
import { ContextFileFormat, ExtractionStatus } from './interfaces/context-document.interface';

describe('ContextExtractionService', () => {
  let service: ContextExtractionService;
  let mockPrisma: {
    ticket: { findUnique: jest.Mock };
    contextDocument: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let mockCacheService: {
    generateFileHash: jest.Mock;
    generateContentHash: jest.Mock;
    getCachedContext: jest.Mock;
    cacheContext: jest.Mock;
    invalidateTicketCache: jest.Mock;
  };
  let mockConfigService: { get: jest.Mock };
  let mockExtractionDuration: { startTimer: jest.Mock };
  let mockUploadsCounter: { inc: jest.Mock };
  let mockErrorsCounter: { inc: jest.Mock };
  let mockDocumentsSize: { observe: jest.Mock };
  let mockCacheHitsCounter: { inc: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      ticket: {
        findUnique: jest.fn(),
      },
      contextDocument: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    mockCacheService = {
      generateFileHash: jest.fn((buffer: Buffer) => 'mock-hash-' + buffer.length),
      generateContentHash: jest.fn((text: string) => 'content-hash-' + text.length),
      getCachedContext: jest.fn().mockResolvedValue(null),
      cacheContext: jest.fn().mockResolvedValue(undefined),
      invalidateTicketCache: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue: unknown) => {
        const config: Record<string, unknown> = {
          'context.maxFileSizeMb': 10,
          'context.storagePath': './uploads/context',
          'context.cacheTtlHours': 24,
        };
        return config[key] ?? defaultValue;
      }),
    };

    mockExtractionDuration = { startTimer: jest.fn().mockReturnValue(jest.fn()) };
    mockUploadsCounter = { inc: jest.fn() };
    mockErrorsCounter = { inc: jest.fn() };
    mockDocumentsSize = { observe: jest.fn() };
    mockCacheHitsCounter = { inc: jest.fn() };

    const mockPdfExtractor = { extract: jest.fn(), supportedFormat: ContextFileFormat.PDF };
    const mockMarkdownExtractor = {
      extract: jest.fn(),
      supportedFormat: ContextFileFormat.MARKDOWN,
    };
    const mockTextExtractor = { extract: jest.fn(), supportedFormat: ContextFileFormat.TEXT };
    const mockDocxExtractor = { extract: jest.fn(), supportedFormat: ContextFileFormat.DOCX };

    service = new ContextExtractionService(
      mockPrisma as unknown as PrismaService,
      mockConfigService as never,
      mockCacheService as unknown as ContextCacheService,
      mockPdfExtractor as unknown as PdfExtractor,
      mockMarkdownExtractor as unknown as MarkdownExtractor,
      mockTextExtractor as unknown as TextExtractor,
      mockDocxExtractor as unknown as DocxExtractor,
      mockExtractionDuration as never,
      mockUploadsCounter as never,
      mockErrorsCounter as never,
      mockDocumentsSize as never,
      mockCacheHitsCounter as never,
    );
  });

  describe('validateFile', () => {
    it('should accept valid PDF file', () => {
      const result = service.validateFile('document.pdf', 1024 * 1024);
      expect(result.isValid).toBe(true);
      expect(result.format).toBe(ContextFileFormat.PDF);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid Markdown file', () => {
      const result = service.validateFile('readme.md', 50000);
      expect(result.isValid).toBe(true);
      expect(result.format).toBe(ContextFileFormat.MARKDOWN);
    });

    it('should accept .markdown extension', () => {
      const result = service.validateFile('docs.markdown', 1000);
      expect(result.isValid).toBe(true);
      expect(result.format).toBe(ContextFileFormat.MARKDOWN);
    });

    it('should accept valid TXT file', () => {
      const result = service.validateFile('notes.txt', 25000);
      expect(result.isValid).toBe(true);
      expect(result.format).toBe(ContextFileFormat.TEXT);
    });

    it('should accept valid DOCX file', () => {
      const result = service.validateFile('report.docx', 2 * 1024 * 1024);
      expect(result.isValid).toBe(true);
      expect(result.format).toBe(ContextFileFormat.DOCX);
    });

    it('should reject unsupported format', () => {
      const result = service.validateFile('image.jpg', 1024);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Unsupported file format'));
    });

    it('should reject file exceeding size limit (10MB)', () => {
      const result = service.validateFile('huge.pdf', 15 * 1024 * 1024);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('exceeds limit'));
    });

    it('should reject empty file', () => {
      const result = service.validateFile('empty.txt', 0);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('File is empty');
    });

    it('should return multiple errors for invalid file', () => {
      const result = service.validateFile('bad.exe', 0);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getDocumentsForTicket', () => {
    it('should return mapped documents for a ticket', async () => {
      const mockDocs = [
        {
          id: 'doc-1',
          ticket_id: 'ticket-1',
          original_filename: 'test.md',
          file_format: 'MARKDOWN',
          file_size_bytes: 1000,
          file_hash: 'abc123',
          storage_path: '/path/test.md',
          extracted_text: 'Test content',
          extraction_status: 'COMPLETED',
          extraction_error: null,
          document_title: 'Test Document',
          document_type: 'spec',
          content_summary: null,
          content_hash: 'hash123',
          cached_at: new Date(),
          cache_expires_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockPrisma.contextDocument.findMany.mockResolvedValue(mockDocs);

      const result = await service.getDocumentsForTicket('ticket-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-1');
      expect(result[0].originalFilename).toBe('test.md');
      expect(result[0].fileFormat).toBe(ContextFileFormat.MARKDOWN);
      expect(result[0].extractionStatus).toBe(ExtractionStatus.COMPLETED);
    });

    it('should return empty array when no documents exist', async () => {
      mockPrisma.contextDocument.findMany.mockResolvedValue([]);

      const result = await service.getDocumentsForTicket('ticket-1');

      expect(result).toHaveLength(0);
    });
  });

  describe('getAggregatedContext', () => {
    it('should return empty context when no documents exist', async () => {
      mockPrisma.contextDocument.findMany.mockResolvedValue([]);

      const result = await service.getAggregatedContext('ticket-1');

      expect(result.documents).toHaveLength(0);
      expect(result.totalWordCount).toBe(0);
      expect(result.documentCount).toBe(0);
      expect(result.formattedContext).toBe('');
    });

    it('should return cached context when available', async () => {
      const cachedContext = {
        documents: [
          {
            documentTitle: 'Test',
            documentType: 'spec',
            content: 'cached',
            wordCount: 1,
            sourceFile: 'test.md',
          },
        ],
        totalWordCount: 1,
        documentCount: 1,
        formattedContext: 'cached content',
      };

      const mockDocs = [
        {
          id: 'doc-1',
          file_hash: 'hash123',
          extraction_status: 'COMPLETED',
          extracted_text: 'Test',
          original_filename: 'test.md',
          document_title: 'Test',
          document_type: 'spec',
        },
      ];

      mockPrisma.contextDocument.findMany.mockResolvedValue(mockDocs);
      mockCacheService.getCachedContext.mockResolvedValue(cachedContext);

      const result = await service.getAggregatedContext('ticket-1');

      expect(result).toEqual(cachedContext);
      expect(mockCacheService.getCachedContext).toHaveBeenCalled();
    });

    it('should aggregate documents and format for prompts', async () => {
      const mockDocs = [
        {
          id: 'doc-1',
          file_hash: 'hash123',
          extraction_status: 'COMPLETED',
          extracted_text: 'First document content',
          original_filename: 'first.md',
          document_title: 'First Doc',
          document_type: 'requirements',
        },
        {
          id: 'doc-2',
          file_hash: 'hash456',
          extraction_status: 'COMPLETED',
          extracted_text: 'Second document content',
          original_filename: 'second.txt',
          document_title: null,
          document_type: null,
        },
      ];

      mockPrisma.contextDocument.findMany.mockResolvedValue(mockDocs);
      mockCacheService.getCachedContext.mockResolvedValue(null);

      const result = await service.getAggregatedContext('ticket-1');

      expect(result.documentCount).toBe(2);
      expect(result.documents).toHaveLength(2);
      expect(result.totalWordCount).toBeGreaterThan(0);
      expect(result.formattedContext).toContain('Project Context Documents');
      expect(result.formattedContext).toContain('First Doc');
      expect(mockCacheService.cacheContext).toHaveBeenCalled();
    });
  });

  describe('deleteDocument', () => {
    it('should throw NotFoundException when document does not exist', async () => {
      mockPrisma.contextDocument.findUnique.mockResolvedValue(null);

      await expect(service.deleteDocument('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should delete document and invalidate cache', async () => {
      const mockDoc = {
        id: 'doc-1',
        ticket_id: 'ticket-1',
        storage_path: '/path/to/file.md',
      };

      mockPrisma.contextDocument.findUnique.mockResolvedValue(mockDoc);
      mockPrisma.contextDocument.delete.mockResolvedValue(mockDoc);

      await service.deleteDocument('doc-1');

      expect(mockPrisma.contextDocument.delete).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
      expect(mockCacheService.invalidateTicketCache).toHaveBeenCalledWith('ticket-1');
    });
  });

  describe('getDocument', () => {
    it('should return null when document does not exist', async () => {
      mockPrisma.contextDocument.findUnique.mockResolvedValue(null);

      const result = await service.getDocument('non-existent');

      expect(result).toBeNull();
    });

    it('should return mapped document when exists', async () => {
      const mockDoc = {
        id: 'doc-1',
        ticket_id: 'ticket-1',
        original_filename: 'test.pdf',
        file_format: 'PDF',
        file_size_bytes: 5000,
        file_hash: 'hash123',
        storage_path: '/path/test.pdf',
        extracted_text: 'PDF content',
        extraction_status: 'COMPLETED',
        extraction_error: null,
        document_title: 'Test PDF',
        document_type: 'spec',
        content_summary: null,
        content_hash: 'content-hash',
        cached_at: new Date(),
        cache_expires_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockPrisma.contextDocument.findUnique.mockResolvedValue(mockDoc);

      const result = await service.getDocument('doc-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('doc-1');
      expect(result!.fileFormat).toBe(ContextFileFormat.PDF);
    });
  });

  describe('uploadDocument', () => {
    const createMockFile = (
      filename: string,
      size: number,
      buffer: Buffer,
    ): Express.Multer.File => ({
      fieldname: 'file',
      originalname: filename,
      encoding: '7bit',
      mimetype: 'text/markdown',
      size,
      buffer,
      stream: null as never,
      destination: '',
      filename: '',
      path: '',
    });

    it('should throw NotFoundException when ticket does not exist', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(null);

      const mockFile = createMockFile('test.md', 100, Buffer.from('content'));

      await expect(service.uploadDocument('non-existent-ticket', mockFile)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for unsupported file format', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 'ticket-1' });

      const mockFile = createMockFile('image.jpg', 100, Buffer.from('image'));

      await expect(service.uploadDocument('ticket-1', mockFile)).rejects.toThrow(
        'Unsupported file format',
      );

      expect(mockUploadsCounter.inc).toHaveBeenCalledWith({
        status: 'rejected',
        format: 'unknown',
      });
    });

    it('should throw BadRequestException for file exceeding size limit', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 'ticket-1' });

      const mockFile = createMockFile('huge.pdf', 15 * 1024 * 1024, Buffer.alloc(15 * 1024 * 1024));

      await expect(service.uploadDocument('ticket-1', mockFile)).rejects.toThrow('exceeds limit');

      expect(mockUploadsCounter.inc).toHaveBeenCalledWith({
        status: 'rejected',
        format: 'PDF',
      });
    });

    it('should return existing document when duplicate file uploaded', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({ id: 'ticket-1' });

      const existingDoc = {
        id: 'existing-doc',
        ticket_id: 'ticket-1',
        original_filename: 'test.md',
        file_format: 'MARKDOWN',
        file_size_bytes: 100,
        file_hash: 'duplicate-hash',
        storage_path: '/path/test.md',
        extracted_text: 'Existing content',
        extraction_status: 'COMPLETED',
        extraction_error: null,
        document_title: 'Existing',
        document_type: 'spec',
        content_summary: null,
        content_hash: 'hash',
        cached_at: new Date(),
        cache_expires_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockPrisma.contextDocument.findUnique.mockResolvedValue(existingDoc);

      const mockFile = createMockFile('test.md', 100, Buffer.from('content'));

      const result = await service.uploadDocument('ticket-1', mockFile);

      expect(result.id).toBe('existing-doc');
      expect(mockPrisma.contextDocument.create).not.toHaveBeenCalled();
    });
  });

  describe('extractContent', () => {
    it('should throw NotFoundException when document does not exist', async () => {
      mockPrisma.contextDocument.findUnique.mockResolvedValue(null);

      await expect(service.extractContent('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should update status to PROCESSING before extraction', async () => {
      const mockDoc = {
        id: 'doc-1',
        file_format: 'MARKDOWN',
        storage_path: '/path/test.md',
      };

      mockPrisma.contextDocument.findUnique.mockResolvedValue(mockDoc);
      mockPrisma.contextDocument.update.mockResolvedValue(mockDoc);

      // Mock extractor to fail so we can check status update
      const extractorMock = service['extractors'].get(ContextFileFormat.MARKDOWN);
      if (extractorMock) {
        (extractorMock.extract as jest.Mock).mockResolvedValue({
          success: false,
          error: 'Test error',
          durationMs: 100,
        });
      }

      await service.extractContent('doc-1');

      expect(mockPrisma.contextDocument.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { extraction_status: ExtractionStatus.PROCESSING },
      });
    });
  });
});
