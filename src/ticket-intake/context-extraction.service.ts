import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram, Counter } from 'prom-client';
import * as path from 'path';
import { safeMkdir, safeWriteFile } from '@/common/utils/safe-fs.util';
import * as crypto from 'crypto';
import { PrismaService } from '@/database/prisma.service';
import { ContextCacheService } from './context-cache.service';
import { PdfExtractor, MarkdownExtractor, TextExtractor, DocxExtractor } from './extractors';
import {
  ContextFileFormat,
  ExtractionStatus,
  IContextDocument,
  IExtractionResult,
  IExtractor,
  IAggregatedContext,
  IContextForPrompt,
  IFileValidation,
  FILE_EXTENSIONS,
} from './interfaces/context-document.interface';
import { CONTEXT_METRICS } from '../common/metrics/context-metrics.provider';

/**
 * Context Extraction Service - Story 2.12
 * FR3: PMs can attach context documents
 * FR59: System extracts project context from ticket metadata
 *
 * Accepts: PDF, MD, TXT, DOCX (max 10MB)
 * Extracts: Full text, document title, metadata
 * Caches: By document hash with configurable TTL
 */
@Injectable()
export class ContextExtractionService {
  private readonly logger = new Logger(ContextExtractionService.name);
  private readonly extractors: Map<ContextFileFormat, IExtractor>;
  private readonly maxFileSizeBytes: number;
  private readonly storagePath: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly cacheService: ContextCacheService,
    private readonly pdfExtractor: PdfExtractor,
    private readonly markdownExtractor: MarkdownExtractor,
    private readonly textExtractor: TextExtractor,
    private readonly docxExtractor: DocxExtractor,
    @InjectMetric(CONTEXT_METRICS.EXTRACTION_DURATION)
    private readonly extractionDuration: Histogram,
    @InjectMetric(CONTEXT_METRICS.UPLOADS_TOTAL)
    private readonly uploadsCounter: Counter,
    @InjectMetric(CONTEXT_METRICS.EXTRACTION_ERRORS)
    private readonly errorsCounter: Counter,
    @InjectMetric(CONTEXT_METRICS.DOCUMENTS_SIZE)
    private readonly documentsSize: Histogram,
    @InjectMetric(CONTEXT_METRICS.CACHE_HITS)
    private readonly cacheHitsCounter: Counter,
  ) {
    this.maxFileSizeBytes =
      this.configService.get<number>('context.maxFileSizeMb', 10) * 1024 * 1024;
    this.storagePath = this.configService.get<string>('context.storagePath', './uploads/context');

    // Register extractors
    this.extractors = new Map<ContextFileFormat, IExtractor>([
      [ContextFileFormat.PDF, pdfExtractor],
      [ContextFileFormat.MARKDOWN, markdownExtractor],
      [ContextFileFormat.TEXT, textExtractor],
      [ContextFileFormat.DOCX, docxExtractor],
    ]);

    // Ensure storage directory exists
    this.ensureStorageDirectory();
  }

  private async ensureStorageDirectory(): Promise<void> {
    try {
      // Use path.parse to get filesystem root for safe mkdir
      const fsRoot = path.parse(this.storagePath).root;
      await safeMkdir(this.storagePath, fsRoot, { recursive: true });
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';
      this.logger.error(`Failed to create storage directory: ${errorMessage}`);
    }
  }

  /**
   * Validate uploaded file format and size
   * AC: Accepts PDF, MD, TXT, DOCX; validates <10MB
   */
  validateFile(filename: string, sizeBytes: number): IFileValidation {
    const errors: string[] = [];
    const ext = path.extname(filename).toLowerCase();
    // Use Map for type-safe extension lookup
    const extensionsMap = new Map(Object.entries(FILE_EXTENSIONS));
    const format = extensionsMap.get(ext);

    if (!format) {
      errors.push(`Unsupported file format: ${ext}. Supported: PDF, MD, TXT, DOCX`);
    }

    if (sizeBytes > this.maxFileSizeBytes) {
      const maxMb = this.maxFileSizeBytes / (1024 * 1024);
      errors.push(
        `File size (${(sizeBytes / (1024 * 1024)).toFixed(2)}MB) exceeds limit (${maxMb}MB)`,
      );
    }

    if (sizeBytes === 0) {
      errors.push('File is empty');
    }

    return {
      isValid: errors.length === 0,
      format,
      errors,
    };
  }

  /**
   * Upload and process a context document
   * AC: Stores references (metadata, extracted text, file location)
   */
  async uploadDocument(
    ticketId: string,
    file: Express.Multer.File,
    documentType?: string,
    documentTitle?: string,
    correlationId?: string,
  ): Promise<IContextDocument> {
    const logPrefix = correlationId ? `[${correlationId}]` : '';

    // Validate ticket exists
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    // Validate file
    const validation = this.validateFile(file.originalname, file.size);
    if (!validation.isValid) {
      this.uploadsCounter.inc({
        status: 'rejected',
        format: validation.format || 'unknown',
      });
      throw new BadRequestException(validation.errors.join('; '));
    }

    // Generate file hash for deduplication
    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Check for duplicate
    const existing = await this.prisma.contextDocument.findUnique({
      where: { file_hash: fileHash },
    });
    if (existing && existing.ticket_id === ticketId) {
      this.logger.debug(`${logPrefix} Duplicate document for ticket ${ticketId}`);
      return this.mapToInterface(existing);
    }

    // Store file
    const storedFilename = `${fileHash}${path.extname(file.originalname)}`;
    const storagePath = path.join(this.storagePath, storedFilename);
    await safeWriteFile(storagePath, this.storagePath, file.buffer);

    // Create database record
    const document = await this.prisma.contextDocument.create({
      data: {
        ticket_id: ticketId,
        original_filename: file.originalname,
        file_format: validation.format!,
        file_size_bytes: file.size,
        file_hash: fileHash,
        storage_path: storagePath,
        extracted_text: '',
        extraction_status: ExtractionStatus.PENDING,
        document_type: documentType,
        document_title: documentTitle,
      },
    });

    this.uploadsCounter.inc({ status: 'uploaded', format: validation.format! });
    this.documentsSize.observe({ format: validation.format! }, file.size);
    this.logger.log(`${logPrefix} Uploaded document ${document.id} for ticket ${ticketId}`);

    // Trigger extraction (synchronous for now, can be async via queue in production)
    await this.extractContent(document.id, correlationId);

    // Refresh and return
    const updated = await this.prisma.contextDocument.findUnique({
      where: { id: document.id },
    });
    return this.mapToInterface(updated!);
  }

  /**
   * Extract content from a document
   * AC: Extracts text content from documents
   */
  async extractContent(documentId: string, correlationId?: string): Promise<IExtractionResult> {
    const logPrefix = correlationId ? `[${correlationId}]` : '';
    const timer = this.extractionDuration.startTimer();

    const document = await this.prisma.contextDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    // Update status to processing
    await this.prisma.contextDocument.update({
      where: { id: documentId },
      data: { extraction_status: ExtractionStatus.PROCESSING },
    });

    const extractor = this.extractors.get(document.file_format as ContextFileFormat);
    if (!extractor) {
      const errorMsg = `No extractor for format: ${document.file_format}`;
      await this.updateExtractionError(documentId, errorMsg);
      this.errorsCounter.inc({
        format: document.file_format,
        reason: 'no_extractor',
      });
      timer({ format: document.file_format, status: 'error' });
      return { success: false, error: errorMsg, durationMs: 0 };
    }

    try {
      const result = await extractor.extract(document.storage_path);
      timer({
        format: document.file_format,
        status: result.success ? 'success' : 'error',
      });

      if (result.success && result.content) {
        const contentHash = this.cacheService.generateContentHash(result.content.text);

        await this.prisma.contextDocument.update({
          where: { id: documentId },
          data: {
            extracted_text: result.content.text,
            extraction_status: ExtractionStatus.COMPLETED,
            extraction_error: null,
            document_title: document.document_title || result.content.title,
            content_hash: contentHash,
            cached_at: new Date(),
            cache_expires_at: new Date(
              Date.now() +
                this.configService.get<number>('context.cacheTtlHours', 24) * 60 * 60 * 1000,
            ),
          },
        });

        this.logger.log(
          `${logPrefix} Extracted ${result.content.wordCount} words from document ${documentId}`,
        );
      } else {
        await this.updateExtractionError(documentId, result.error || 'Unknown extraction error');
        this.errorsCounter.inc({
          format: document.file_format,
          reason: 'extraction_failed',
        });
      }

      return result;
    } catch (_error) {
      timer({ format: document.file_format, status: 'error' });
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';
      this.errorsCounter.inc({
        format: document.file_format,
        reason: 'exception',
      });
      await this.updateExtractionError(documentId, errorMessage);
      this.logger.error(
        `${logPrefix} Extraction failed: ${errorMessage}`,
        _error instanceof Error ? _error.stack : undefined,
      );
      return { success: false, error: errorMessage, durationMs: 0 };
    }
  }

  private async updateExtractionError(documentId: string, _error: string): Promise<void> {
    await this.prisma.contextDocument.update({
      where: { id: documentId },
      data: {
        extraction_status: ExtractionStatus.FAILED,
        extraction_error: _error,
      },
    });
  }

  /**
   * Get all context documents for a ticket
   */
  async getDocumentsForTicket(ticketId: string): Promise<IContextDocument[]> {
    const documents = await this.prisma.contextDocument.findMany({
      where: { ticket_id: ticketId },
      orderBy: { created_at: 'asc' },
    });
    return documents.map((doc) => this.mapToInterface(doc));
  }

  /**
   * Get a single context document
   */
  async getDocument(documentId: string): Promise<IContextDocument | null> {
    const document = await this.prisma.contextDocument.findUnique({
      where: { id: documentId },
    });
    return document ? this.mapToInterface(document) : null;
  }

  /**
   * Get aggregated context for AI prompts (FR59)
   * AC: Full text extracted and formatted, document titles as headers
   */
  async getAggregatedContext(
    ticketId: string,
    correlationId?: string,
  ): Promise<IAggregatedContext> {
    const logPrefix = correlationId ? `[${correlationId}]` : '';

    const documents = await this.prisma.contextDocument.findMany({
      where: {
        ticket_id: ticketId,
        extraction_status: ExtractionStatus.COMPLETED,
      },
      orderBy: { created_at: 'asc' },
    });

    if (documents.length === 0) {
      return {
        documents: [],
        totalWordCount: 0,
        documentCount: 0,
        formattedContext: '',
      };
    }

    // Check cache
    const documentHashes = documents.map((d) => d.file_hash);
    const cached = await this.cacheService.getCachedContext(ticketId, documentHashes);
    if (cached) {
      this.cacheHitsCounter.inc({ hit: 'true' });
      this.logger.debug(`${logPrefix} Using cached context for ticket ${ticketId}`);
      return cached;
    }
    this.cacheHitsCounter.inc({ hit: 'false' });

    // Build aggregated context
    const contextDocuments: IContextForPrompt[] = documents.map((doc) => ({
      documentTitle: doc.document_title || doc.original_filename,
      documentType: doc.document_type || 'general',
      content: doc.extracted_text,
      wordCount: doc.extracted_text.split(/\s+/).filter((w) => w.length > 0).length,
      sourceFile: doc.original_filename,
    }));

    const totalWordCount = contextDocuments.reduce((sum, d) => sum + d.wordCount, 0);

    // Format for prompt injection
    const formattedContext = this.formatContextForPrompt(contextDocuments);

    const result: IAggregatedContext = {
      documents: contextDocuments,
      totalWordCount,
      documentCount: documents.length,
      formattedContext,
    };

    // Cache result
    await this.cacheService.cacheContext(ticketId, documentHashes, result);

    this.logger.log(
      `${logPrefix} Aggregated ${documents.length} documents (${totalWordCount} words) for ticket ${ticketId}`,
    );

    return result;
  }

  /**
   * Format context documents for AI prompt injection
   */
  private formatContextForPrompt(documents: IContextForPrompt[]): string {
    if (documents.length === 0) {
      return '';
    }

    const sections = documents.map((doc, index) => {
      return `
### Context Document ${index + 1}: ${doc.documentTitle}
**Type:** ${doc.documentType}
**Source:** ${doc.sourceFile}
**Word Count:** ${doc.wordCount}

---

${doc.content}

---
`;
    });

    return `
## Project Context Documents

The following context documents have been attached to provide background information for this task.

${sections.join('\n')}

**Total Context:** ${documents.length} document(s)
`;
  }

  /**
   * Delete a context document
   */
  async deleteDocument(documentId: string): Promise<void> {
    const document = await this.prisma.contextDocument.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    // Delete file using safe unlink with storage root validation
    try {
      const { safeUnlink } = await import('../common/utils/safe-fs.util');
      await safeUnlink(document.storage_path, this.storagePath);
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';
      this.logger.warn(`Failed to delete file: ${errorMessage}`);
    }

    // Delete record
    await this.prisma.contextDocument.delete({
      where: { id: documentId },
    });

    // Invalidate cache
    await this.cacheService.invalidateTicketCache(document.ticket_id);

    this.logger.log(`Deleted document ${documentId}`);
  }

  /**
   * Map Prisma model to interface
   */
  private mapToInterface(doc: {
    id: string;
    ticket_id: string;
    original_filename: string;
    file_format: string;
    file_size_bytes: number;
    file_hash: string;
    storage_path: string;
    extracted_text: string;
    extraction_status: string;
    extraction_error: string | null;
    document_title: string | null;
    document_type: string | null;
    content_summary: string | null;
    content_hash: string | null;
    cached_at: Date | null;
    cache_expires_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }): IContextDocument {
    return {
      id: doc.id,
      ticketId: doc.ticket_id,
      originalFilename: doc.original_filename,
      fileFormat: doc.file_format as ContextFileFormat,
      fileSizeBytes: doc.file_size_bytes,
      fileHash: doc.file_hash,
      storagePath: doc.storage_path,
      extractedText: doc.extracted_text,
      extractionStatus: doc.extraction_status as ExtractionStatus,
      extractionError: doc.extraction_error ?? undefined,
      documentTitle: doc.document_title ?? undefined,
      documentType: doc.document_type ?? undefined,
      contentSummary: doc.content_summary ?? undefined,
      contentHash: doc.content_hash ?? undefined,
      cachedAt: doc.cached_at ?? undefined,
      cacheExpiresAt: doc.cache_expires_at ?? undefined,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    };
  }
}
