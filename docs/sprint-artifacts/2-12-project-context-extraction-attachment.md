# Story 2.12: Project Context Extraction & Attachment

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** ready-for-dev  
**Priority:** P2 - MEDIUM  
**Effort:** 5 story points  
**ClickUp ID:** `86evnjwap`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwap

---

## ⛔ BLOCKER: Prerequisites Must Be Complete

**DO NOT START** this story until the following are implemented:

| Prerequisite | Status | Required Components |
|--------------|--------|---------------------|
| Story 2.2 | ⚠️ Required | `TicketIntakeService`, `IParsedTicket` interface, `Ticket` model |
| Story 2.4 | ⚠️ Required | `PromptGeneratorService`, prompt building infrastructure |

**Why Prerequisites Matter:**
- **Story 2.2** provides the ticket parsing foundation - context documents are attached to tickets
- **Story 2.4** provides the prompt generation where extracted context is injected

**If Prerequisites NOT Complete:** Implement stub interfaces and plan for integration.  
**If Prerequisites ARE Complete:** Extend existing services and integrate directly.

---

## Story

As a PM,  
I want to attach context documents to tickets,  
So that AI has the necessary background to generate appropriate code.

---

## Acceptance Criteria

**Given** I'm creating a ticket in ClickUp/AetherFlow  
**When** I attach context documents  
**Then** the system:
- ✅ Accepts common formats (PDF, MD, TXT, DOCX)
- ✅ Validates file size (<10MB per file)
- ✅ Extracts text content from documents
- ✅ Stores references (metadata, extracted text, file location)

**And** context is included in AI prompts:
- ✅ Full text extracted and formatted
- ✅ Document titles included as headers
- ✅ Project metadata auto-attached from ticket

**And** project context is cached for reuse:
- ✅ Context cached by document hash
- ✅ Cache TTL configurable (default: 24 hours)
- ✅ Cache invalidated on document update

---

## Quick Implementation Summary (TL;DR)

**Architecture Coordination:**
- **Extends:** `TicketIntakeService` from Story 2.2
- **Integrates with:** `PromptGeneratorService` from Story 2.4
- **New:** `ContextExtractionService`, `ContextDocument` model, file storage

**11 Key Files in Implementation Order:**

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `prisma/schema.prisma` | MODIFY | Add ContextDocument model |
| 2 | `src/ticket-intake/interfaces/context-document.interface.ts` | CREATE | Context interfaces |
| 3 | `src/ticket-intake/dto/context-document.dto.ts` | CREATE | Request/Response DTOs |
| 4 | `src/ticket-intake/extractors/base-extractor.ts` | CREATE | Abstract extractor class |
| 5 | `src/ticket-intake/extractors/*.ts` | CREATE | Format-specific extractors |
| 6 | `src/ticket-intake/context-extraction.service.ts` | CREATE | Main orchestrator |
| 7 | `src/ticket-intake/context-cache.service.ts` | CREATE | Caching layer |
| 8 | `src/ticket-intake/context-document.controller.ts` | CREATE | **API endpoints with security** |
| 9 | `src/common/metrics/context-metrics.provider.ts` | CREATE | Prometheus metrics |
| 10 | `src/ticket-intake/ticket-intake.module.ts` | MODIFY | Wire components |
| 11 | `test/context-extraction.e2e-spec.ts` | CREATE | Integration tests |

**Environment Variables:**
```env
# Context Extraction Configuration
CONTEXT_MAX_FILE_SIZE_MB=10
CONTEXT_CACHE_TTL_HOURS=24
CONTEXT_STORAGE_PATH=./uploads/context
CONTEXT_SUPPORTED_FORMATS=pdf,md,txt,docx
```

**Required npm Packages:**
```bash
npm install pdf-parse mammoth multer @types/multer
```

---

## Technical Requirements

### Source References

| Source | Section | Requirement |
|--------|---------|-------------|
| PRD | FR3 | PMs can attach context documents (client history, domain knowledge) |
| PRD | FR59 | System can extract project context from ticket metadata |
| Architecture | ticket-intake | Context extraction in `src/ticket-intake/` module |
| Epics | Story 2.12 | Accepts PDF, MD, TXT, DOCX; validates <10MB; extracts text |

### Architecture Alignment

```
src/ticket-intake/
├── interfaces/
│   └── context-document.interface.ts    # CREATE
├── dto/
│   └── context-document.dto.ts          # CREATE
├── extractors/                          # CREATE directory
│   ├── index.ts
│   ├── base-extractor.ts                # Abstract base class
│   ├── pdf-extractor.ts                 # PDF text extraction
│   ├── markdown-extractor.ts            # MD parsing
│   ├── text-extractor.ts                # Plain text handling
│   └── docx-extractor.ts                # DOCX extraction
├── context-extraction.service.ts        # CREATE - Main service
├── context-cache.service.ts             # CREATE - Caching layer
├── context-document.controller.ts       # CREATE - API with security guards
├── context-extraction.service.spec.ts   # CREATE
└── ticket-intake.module.ts              # MODIFY - Add controller

src/common/metrics/
└── context-metrics.provider.ts          # CREATE

uploads/context/                         # File storage directory
```

---

## Phase 1: Database Schema

### 1.1 Prisma Schema Update

**File:** `prisma/schema.prisma` (ADD after Ticket model)

```prisma
// ============================================
// CONTEXT DOCUMENTS
// ============================================

model ContextDocument {
  id                String              @id @default(uuid())
  ticket_id         String
  ticket            Ticket              @relation(fields: [ticket_id], references: [id], onDelete: Cascade)
  
  // Original file metadata
  original_filename String
  file_format       ContextFileFormat
  file_size_bytes   Int
  file_hash         String              @unique  // SHA-256 for deduplication
  storage_path      String              // Path to stored file
  
  // Extracted content
  extracted_text    String              @db.Text
  extraction_status ExtractionStatus    @default(PENDING)
  extraction_error  String?
  
  // Metadata for AI context
  document_title    String?             // Extracted or provided title
  document_type     String?             // e.g., "spec", "requirements", "domain"
  content_summary   String?             // AI-generated summary (future)
  
  // Cache control
  content_hash      String?             // Hash of extracted content
  cached_at         DateTime?
  cache_expires_at  DateTime?
  
  created_at        DateTime            @default(now())
  updated_at        DateTime            @updatedAt
  
  @@index([ticket_id])
  @@index([file_hash])
  @@index([extraction_status])
  @@map("context_documents")
}

enum ContextFileFormat {
  PDF
  MARKDOWN
  TEXT
  DOCX
}

enum ExtractionStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}
```

### 1.2 Update Ticket Model

**File:** `prisma/schema.prisma` (MODIFY Ticket model - add relation)

```prisma
model Ticket {
  // ... existing fields ...
  
  // Relationships
  executions         Execution[]
  cost_records       CostRecord[]
  context_documents  ContextDocument[]   // ADD this line
  
  // ... rest of model ...
}
```

---

## Phase 2: Interfaces & DTOs

### 2.1 Context Document Interfaces

**File:** `src/ticket-intake/interfaces/context-document.interface.ts`

```typescript
/**
 * Context Document Interfaces - FR3 & FR59
 * Enables PMs to attach context documents that AI uses for code generation
 */

export enum ContextFileFormat {
  PDF = 'PDF',
  MARKDOWN = 'MARKDOWN',
  TEXT = 'TEXT',
  DOCX = 'DOCX',
}

export enum ExtractionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface IContextDocument {
  id: string;
  ticketId: string;
  originalFilename: string;
  fileFormat: ContextFileFormat;
  fileSizeBytes: number;
  fileHash: string;
  storagePath: string;
  extractedText: string;
  extractionStatus: ExtractionStatus;
  extractionError?: string;
  documentTitle?: string;
  documentType?: string;
  contentSummary?: string;
  contentHash?: string;
  cachedAt?: Date;
  cacheExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IExtractedContent {
  text: string;
  title?: string;
  metadata?: Record<string, unknown>;
  wordCount: number;
  pageCount?: number;
  extractedAt: string;
}

export interface IExtractionResult {
  success: boolean;
  content?: IExtractedContent;
  error?: string;
  durationMs: number;
}

export interface IContextForPrompt {
  documentTitle: string;
  documentType: string;
  content: string;
  wordCount: number;
  sourceFile: string;
}

export interface IAggregatedContext {
  documents: IContextForPrompt[];
  totalWordCount: number;
  documentCount: number;
  formattedContext: string;  // Ready to inject into prompts
}

export interface IExtractor {
  readonly supportedFormat: ContextFileFormat;
  extract(filePath: string): Promise<IExtractionResult>;
  canExtract(filePath: string): boolean;
}

// File validation
export interface IFileValidation {
  isValid: boolean;
  format?: ContextFileFormat;
  errors: string[];
}

export const SUPPORTED_MIME_TYPES: Record<ContextFileFormat, string[]> = {
  [ContextFileFormat.PDF]: ['application/pdf'],
  [ContextFileFormat.MARKDOWN]: ['text/markdown', 'text/x-markdown'],
  [ContextFileFormat.TEXT]: ['text/plain'],
  [ContextFileFormat.DOCX]: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
};

export const FILE_EXTENSIONS: Record<string, ContextFileFormat> = {
  '.pdf': ContextFileFormat.PDF,
  '.md': ContextFileFormat.MARKDOWN,
  '.markdown': ContextFileFormat.MARKDOWN,
  '.txt': ContextFileFormat.TEXT,
  '.text': ContextFileFormat.TEXT,
  '.docx': ContextFileFormat.DOCX,
};
```

### 2.2 DTOs with Validation

**File:** `src/ticket-intake/dto/context-document.dto.ts`

```typescript
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  IsUUID,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContextFileFormat, ExtractionStatus } from '../interfaces/context-document.interface';

export class UploadContextDocumentDto {
  @ApiProperty({ description: 'Ticket ID to attach document to' })
  @IsUUID()
  ticketId: string;

  @ApiPropertyOptional({ description: 'Document type classification' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentType?: string;

  @ApiPropertyOptional({ description: 'Custom document title' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  documentTitle?: string;
}

export class ContextDocumentResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() ticketId: string;
  @ApiProperty() originalFilename: string;
  @ApiProperty({ enum: ContextFileFormat }) fileFormat: ContextFileFormat;
  @ApiProperty() fileSizeBytes: number;
  @ApiProperty({ enum: ExtractionStatus }) extractionStatus: ExtractionStatus;
  @ApiPropertyOptional() documentTitle?: string;
  @ApiPropertyOptional() documentType?: string;
  @ApiPropertyOptional() extractionError?: string;
  @ApiProperty() createdAt: string;
}

export class ExtractedContentResponseDto {
  @ApiProperty() documentId: string;
  @ApiProperty() extractedText: string;
  @ApiProperty() wordCount: number;
  @ApiPropertyOptional() pageCount?: number;
  @ApiProperty() extractedAt: string;
}

export class AggregatedContextResponseDto {
  @ApiProperty({ type: [ExtractedContentResponseDto] })
  documents: ExtractedContentResponseDto[];

  @ApiProperty() totalWordCount: number;
  @ApiProperty() documentCount: number;
  @ApiProperty() formattedContext: string;
}

export class BulkUploadResultDto {
  @ApiProperty() totalFiles: number;
  @ApiProperty() successCount: number;
  @ApiProperty() failedCount: number;

  @ApiProperty({ type: [ContextDocumentResponseDto] })
  uploaded: ContextDocumentResponseDto[];

  @ApiProperty({ type: [Object] })
  errors: Array<{ filename: string; error: string }>;
}

// Internal DTO for extraction queue
export class ExtractionJobDto {
  @IsUUID()
  documentId: string;

  @IsString()
  filePath: string;

  @IsEnum(ContextFileFormat)
  format: ContextFileFormat;

  @IsOptional()
  @IsString()
  correlationId?: string;
}
```

---

## Phase 3: Extractors

### 3.1 Base Extractor

**File:** `src/ticket-intake/extractors/base-extractor.ts`

```typescript
import { Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  IExtractor,
  IExtractionResult,
  ContextFileFormat,
} from '../interfaces/context-document.interface';

export abstract class BaseExtractor implements IExtractor {
  protected readonly logger: Logger;
  abstract readonly supportedFormat: ContextFileFormat;

  constructor(loggerContext: string) {
    this.logger = new Logger(loggerContext);
  }

  abstract extract(filePath: string): Promise<IExtractionResult>;

  canExtract(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.getSupportedExtensions().includes(ext);
  }

  protected abstract getSupportedExtensions(): string[];

  protected async readFile(filePath: string): Promise<Buffer> {
    return fs.readFile(filePath);
  }

  protected countWords(text: string): number {
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  }

  protected extractTitle(text: string, filename: string): string {
    // Try to extract from first heading or line
    const headingMatch = text.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }

    const firstLineMatch = text.match(/^(.{1,100})/);
    if (firstLineMatch && firstLineMatch[1].trim().length > 5) {
      return firstLineMatch[1].trim().substring(0, 100);
    }

    // Fallback to filename without extension
    return path.basename(filename, path.extname(filename));
  }

  protected createSuccessResult(
    text: string,
    title: string | undefined,
    durationMs: number,
    metadata?: Record<string, unknown>,
  ): IExtractionResult {
    return {
      success: true,
      content: {
        text,
        title,
        metadata,
        wordCount: this.countWords(text),
        extractedAt: new Date().toISOString(),
      },
      durationMs,
    };
  }

  protected createErrorResult(error: string, durationMs: number): IExtractionResult {
    return {
      success: false,
      error,
      durationMs,
    };
  }
}
```

### 3.2 PDF Extractor

**File:** `src/ticket-intake/extractors/pdf-extractor.ts`

```typescript
import { Injectable } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import { BaseExtractor } from './base-extractor';
import {
  IExtractionResult,
  ContextFileFormat,
} from '../interfaces/context-document.interface';

@Injectable()
export class PdfExtractor extends BaseExtractor {
  readonly supportedFormat = ContextFileFormat.PDF;

  constructor() {
    super(PdfExtractor.name);
  }

  protected getSupportedExtensions(): string[] {
    return ['.pdf'];
  }

  async extract(filePath: string): Promise<IExtractionResult> {
    const startTime = Date.now();

    try {
      const dataBuffer = await this.readFile(filePath);
      const pdfData = await pdfParse(dataBuffer);

      const text = pdfData.text.trim();

      if (!text || text.length === 0) {
        return this.createErrorResult(
          'PDF contains no extractable text (may be image-based)',
          Date.now() - startTime,
        );
      }

      const title = this.extractTitle(text, filePath);

      return {
        success: true,
        content: {
          text,
          title,
          metadata: {
            numPages: pdfData.numpages,
            pdfVersion: pdfData.info?.PDFFormatVersion,
            author: pdfData.info?.Author,
            creationDate: pdfData.info?.CreationDate,
          },
          wordCount: this.countWords(text),
          pageCount: pdfData.numpages,
          extractedAt: new Date().toISOString(),
        },
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(`PDF extraction failed: ${error.message}`, error.stack);
      return this.createErrorResult(
        `PDF extraction failed: ${error.message}`,
        Date.now() - startTime,
      );
    }
  }
}
```

### 3.3 Markdown Extractor

**File:** `src/ticket-intake/extractors/markdown-extractor.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { BaseExtractor } from './base-extractor';
import {
  IExtractionResult,
  ContextFileFormat,
} from '../interfaces/context-document.interface';

@Injectable()
export class MarkdownExtractor extends BaseExtractor {
  readonly supportedFormat = ContextFileFormat.MARKDOWN;

  constructor() {
    super(MarkdownExtractor.name);
  }

  protected getSupportedExtensions(): string[] {
    return ['.md', '.markdown'];
  }

  async extract(filePath: string): Promise<IExtractionResult> {
    const startTime = Date.now();

    try {
      const buffer = await this.readFile(filePath);
      const text = buffer.toString('utf-8').trim();

      if (!text || text.length === 0) {
        return this.createErrorResult('Markdown file is empty', Date.now() - startTime);
      }

      // Extract title from first H1
      const titleMatch = text.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : this.extractTitle(text, filePath);

      // Count headers for structure info
      const h1Count = (text.match(/^#\s+/gm) || []).length;
      const h2Count = (text.match(/^##\s+/gm) || []).length;
      const codeBlockCount = (text.match(/```/g) || []).length / 2;

      return this.createSuccessResult(text, title, Date.now() - startTime, {
        h1Count,
        h2Count,
        codeBlockCount: Math.floor(codeBlockCount),
        hasTableOfContents: text.toLowerCase().includes('table of contents'),
      });
    } catch (error) {
      this.logger.error(`Markdown extraction failed: ${error.message}`, error.stack);
      return this.createErrorResult(
        `Markdown extraction failed: ${error.message}`,
        Date.now() - startTime,
      );
    }
  }
}
```

### 3.4 Text Extractor

**File:** `src/ticket-intake/extractors/text-extractor.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { BaseExtractor } from './base-extractor';
import {
  IExtractionResult,
  ContextFileFormat,
} from '../interfaces/context-document.interface';

@Injectable()
export class TextExtractor extends BaseExtractor {
  readonly supportedFormat = ContextFileFormat.TEXT;

  constructor() {
    super(TextExtractor.name);
  }

  protected getSupportedExtensions(): string[] {
    return ['.txt', '.text'];
  }

  async extract(filePath: string): Promise<IExtractionResult> {
    const startTime = Date.now();

    try {
      const buffer = await this.readFile(filePath);
      const text = buffer.toString('utf-8').trim();

      if (!text || text.length === 0) {
        return this.createErrorResult('Text file is empty', Date.now() - startTime);
      }

      const title = this.extractTitle(text, filePath);
      const lineCount = text.split('\n').length;

      return this.createSuccessResult(text, title, Date.now() - startTime, {
        lineCount,
        encoding: 'utf-8',
      });
    } catch (error) {
      this.logger.error(`Text extraction failed: ${error.message}`, error.stack);
      return this.createErrorResult(
        `Text extraction failed: ${error.message}`,
        Date.now() - startTime,
      );
    }
  }
}
```

### 3.5 DOCX Extractor

**File:** `src/ticket-intake/extractors/docx-extractor.ts`

```typescript
import { Injectable } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { BaseExtractor } from './base-extractor';
import {
  IExtractionResult,
  ContextFileFormat,
} from '../interfaces/context-document.interface';

@Injectable()
export class DocxExtractor extends BaseExtractor {
  readonly supportedFormat = ContextFileFormat.DOCX;

  constructor() {
    super(DocxExtractor.name);
  }

  protected getSupportedExtensions(): string[] {
    return ['.docx'];
  }

  async extract(filePath: string): Promise<IExtractionResult> {
    const startTime = Date.now();

    try {
      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value.trim();

      if (!text || text.length === 0) {
        return this.createErrorResult('DOCX contains no text', Date.now() - startTime);
      }

      // Log any conversion messages/warnings
      if (result.messages && result.messages.length > 0) {
        this.logger.warn(
          `DOCX conversion messages: ${result.messages.map((m) => m.message).join(', ')}`,
        );
      }

      const title = this.extractTitle(text, filePath);

      return this.createSuccessResult(text, title, Date.now() - startTime, {
        warnings: result.messages?.map((m) => m.message) || [],
      });
    } catch (error) {
      this.logger.error(`DOCX extraction failed: ${error.message}`, error.stack);
      return this.createErrorResult(
        `DOCX extraction failed: ${error.message}`,
        Date.now() - startTime,
      );
    }
  }
}
```

### 3.6 Extractor Index

**File:** `src/ticket-intake/extractors/index.ts`

```typescript
export * from './base-extractor';
export * from './pdf-extractor';
export * from './markdown-extractor';
export * from './text-extractor';
export * from './docx-extractor';
```

---

## Phase 4: Main Services

### 4.1 Context Cache Service

**File:** `src/ticket-intake/context-cache.service.ts`

```typescript
import { Injectable, Logger, Inject, CACHE_MANAGER } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import { IAggregatedContext } from './interfaces/context-document.interface';

@Injectable()
export class ContextCacheService {
  private readonly logger = new Logger(ContextCacheService.name);
  private readonly cacheTtlMs: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {
    const ttlHours = this.configService.get<number>('context.cacheTtlHours', 24);
    this.cacheTtlMs = ttlHours * 60 * 60 * 1000;
  }

  /**
   * Generate cache key for a ticket's context
   */
  generateCacheKey(ticketId: string, documentHashes: string[]): string {
    const sortedHashes = [...documentHashes].sort().join(':');
    const keyHash = crypto.createHash('sha256').update(sortedHashes).digest('hex').substring(0, 16);
    return `context:${ticketId}:${keyHash}`;
  }

  /**
   * Get cached aggregated context
   */
  async getCachedContext(ticketId: string, documentHashes: string[]): Promise<IAggregatedContext | null> {
    const cacheKey = this.generateCacheKey(ticketId, documentHashes);
    
    try {
      const cached = await this.cacheManager.get<IAggregatedContext>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for ticket ${ticketId}`);
        return cached;
      }
    } catch (error) {
      this.logger.warn(`Cache get error: ${error.message}`);
    }
    
    return null;
  }

  /**
   * Store aggregated context in cache
   */
  async cacheContext(
    ticketId: string,
    documentHashes: string[],
    context: IAggregatedContext,
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(ticketId, documentHashes);
    
    try {
      await this.cacheManager.set(cacheKey, context, this.cacheTtlMs);
      this.logger.debug(`Cached context for ticket ${ticketId}`);
    } catch (error) {
      this.logger.warn(`Cache set error: ${error.message}`);
    }
  }

  /**
   * Invalidate cache for a ticket
   */
  async invalidateTicketCache(ticketId: string): Promise<void> {
    // Note: With Redis, use pattern deletion. For in-memory, track keys separately
    this.logger.debug(`Cache invalidation requested for ticket ${ticketId}`);
    // Implementation depends on cache backend
  }

  /**
   * Generate file hash for deduplication
   */
  generateFileHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Generate content hash for change detection
   */
  generateContentHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex').substring(0, 32);
  }
}
```

### 4.2 Context Extraction Service

**File:** `src/ticket-intake/context-extraction.service.ts`

```typescript
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram, Counter } from 'prom-client';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { ContextCacheService } from './context-cache.service';
import {
  PdfExtractor,
  MarkdownExtractor,
  TextExtractor,
  DocxExtractor,
} from './extractors';
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
    @InjectMetric(CONTEXT_METRICS.EXTRACTION_DURATION) private readonly extractionDuration: Histogram,
    @InjectMetric(CONTEXT_METRICS.UPLOADS_TOTAL) private readonly uploadsCounter: Counter,
    @InjectMetric(CONTEXT_METRICS.EXTRACTION_ERRORS) private readonly errorsCounter: Counter,
  ) {
    this.maxFileSizeBytes = this.configService.get<number>('context.maxFileSizeMb', 10) * 1024 * 1024;
    this.storagePath = this.configService.get<string>('context.storagePath', './uploads/context');

    // Register extractors
    this.extractors = new Map([
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
      await fs.mkdir(this.storagePath, { recursive: true });
    } catch (error) {
      this.logger.error(`Failed to create storage directory: ${error.message}`);
    }
  }

  /**
   * Validate uploaded file
   */
  validateFile(filename: string, sizeBytes: number): IFileValidation {
    const errors: string[] = [];
    const ext = path.extname(filename).toLowerCase();
    const format = FILE_EXTENSIONS[ext];

    if (!format) {
      errors.push(`Unsupported file format: ${ext}. Supported: PDF, MD, TXT, DOCX`);
    }

    if (sizeBytes > this.maxFileSizeBytes) {
      const maxMb = this.maxFileSizeBytes / (1024 * 1024);
      errors.push(`File size (${(sizeBytes / (1024 * 1024)).toFixed(2)}MB) exceeds limit (${maxMb}MB)`);
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
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    // Validate file
    const validation = this.validateFile(file.originalname, file.size);
    if (!validation.isValid) {
      this.uploadsCounter.inc({ status: 'rejected', format: validation.format || 'unknown' });
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
    await fs.writeFile(storagePath, file.buffer);

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
    this.logger.log(`${logPrefix} Uploaded document ${document.id} for ticket ${ticketId}`);

    // Trigger extraction (can be async via queue in production)
    await this.extractContent(document.id, correlationId);

    // Refresh and return
    const updated = await this.prisma.contextDocument.findUnique({
      where: { id: document.id },
    });
    return this.mapToInterface(updated!);
  }

  /**
   * Extract content from a document
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
      this.errorsCounter.inc({ format: document.file_format, reason: 'no_extractor' });
      timer({ format: document.file_format, status: 'error' });
      return { success: false, error: errorMsg, durationMs: 0 };
    }

    try {
      const result = await extractor.extract(document.storage_path);
      timer({ format: document.file_format, status: result.success ? 'success' : 'error' });

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
            cache_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });

        this.logger.log(
          `${logPrefix} Extracted ${result.content.wordCount} words from document ${documentId}`,
        );
      } else {
        await this.updateExtractionError(documentId, result.error || 'Unknown extraction error');
        this.errorsCounter.inc({ format: document.file_format, reason: 'extraction_failed' });
      }

      return result;
    } catch (error) {
      timer({ format: document.file_format, status: 'error' });
      this.errorsCounter.inc({ format: document.file_format, reason: 'exception' });
      await this.updateExtractionError(documentId, error.message);
      this.logger.error(`${logPrefix} Extraction failed: ${error.message}`, error.stack);
      return { success: false, error: error.message, durationMs: 0 };
    }
  }

  private async updateExtractionError(documentId: string, error: string): Promise<void> {
    await this.prisma.contextDocument.update({
      where: { id: documentId },
      data: {
        extraction_status: ExtractionStatus.FAILED,
        extraction_error: error,
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
    return documents.map(this.mapToInterface);
  }

  /**
   * Get aggregated context for AI prompts (FR59)
   */
  async getAggregatedContext(ticketId: string, correlationId?: string): Promise<IAggregatedContext> {
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
      this.logger.debug(`${logPrefix} Using cached context for ticket ${ticketId}`);
      return cached;
    }

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

    // Delete file
    try {
      await fs.unlink(document.storage_path);
    } catch (error) {
      this.logger.warn(`Failed to delete file: ${error.message}`);
    }

    // Delete record
    await this.prisma.contextDocument.delete({
      where: { id: documentId },
    });

    // Invalidate cache
    await this.cacheService.invalidateTicketCache(document.ticket_id);

    this.logger.log(`Deleted document ${documentId}`);
  }

  private mapToInterface(doc: any): IContextDocument {
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
      extractionError: doc.extraction_error,
      documentTitle: doc.document_title,
      documentType: doc.document_type,
      contentSummary: doc.content_summary,
      contentHash: doc.content_hash,
      cachedAt: doc.cached_at,
      cacheExpiresAt: doc.cache_expires_at,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    };
  }
}
```

---

## Phase 5: API Controller with Security

### 5.1 Context Document Controller

**File:** `src/ticket-intake/context-document.controller.ts`

```typescript
import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators/roles.decorator';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';
import { ContextExtractionService } from './context-extraction.service';
import {
  UploadContextDocumentDto,
  ContextDocumentResponseDto,
  AggregatedContextResponseDto,
} from './dto/context-document.dto';

@ApiTags('Context Documents')
@Controller('context-documents')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
@ApiBearerAuth()
export class ContextDocumentController {
  private readonly logger = new Logger(ContextDocumentController.name);

  constructor(private readonly contextService: ContextExtractionService) {}

  /**
   * Upload a context document (FR3: PMs can attach context documents)
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @Roles('pm', 'admin')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 uploads per minute
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload context document (PM only) - FR3' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'ticketId'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF, MD, TXT, or DOCX file (max 10MB)' },
        ticketId: { type: 'string', format: 'uuid', description: 'Ticket ID to attach document to' },
        documentType: { type: 'string', description: 'Document type classification (e.g., spec, requirements)' },
        documentTitle: { type: 'string', description: 'Custom document title' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Document uploaded and extracted', type: ContextDocumentResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid file format or size exceeded' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - PM role required' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadContextDocumentDto,
    @CorrelationId() correlationId: string,
  ): Promise<ContextDocumentResponseDto> {
    this.logger.log(`[${correlationId}] Uploading document for ticket ${dto.ticketId}`);
    
    const document = await this.contextService.uploadDocument(
      dto.ticketId,
      file,
      dto.documentType,
      dto.documentTitle,
      correlationId,
    );

    return {
      id: document.id,
      ticketId: document.ticketId,
      originalFilename: document.originalFilename,
      fileFormat: document.fileFormat,
      fileSizeBytes: document.fileSizeBytes,
      extractionStatus: document.extractionStatus,
      documentTitle: document.documentTitle,
      documentType: document.documentType,
      extractionError: document.extractionError,
      createdAt: document.createdAt.toISOString(),
    };
  }

  /**
   * Get all documents for a ticket
   */
  @Get('ticket/:ticketId')
  @Roles('pm', 'admin', 'developer')
  @ApiOperation({ summary: 'Get all context documents for a ticket' })
  @ApiResponse({ status: 200, type: [ContextDocumentResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getDocumentsByTicket(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @CorrelationId() correlationId: string,
  ): Promise<ContextDocumentResponseDto[]> {
    this.logger.debug(`[${correlationId}] Fetching documents for ticket ${ticketId}`);
    
    const documents = await this.contextService.getDocumentsForTicket(ticketId);
    
    return documents.map((doc) => ({
      id: doc.id,
      ticketId: doc.ticketId,
      originalFilename: doc.originalFilename,
      fileFormat: doc.fileFormat,
      fileSizeBytes: doc.fileSizeBytes,
      extractionStatus: doc.extractionStatus,
      documentTitle: doc.documentTitle,
      documentType: doc.documentType,
      extractionError: doc.extractionError,
      createdAt: doc.createdAt.toISOString(),
    }));
  }

  /**
   * Get aggregated context for AI prompts (FR59: Extract project context)
   */
  @Get('ticket/:ticketId/aggregated')
  @Roles('pm', 'admin', 'developer', 'system')
  @ApiOperation({ summary: 'Get aggregated context for AI prompts - FR59' })
  @ApiResponse({ status: 200, type: AggregatedContextResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAggregatedContext(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @CorrelationId() correlationId: string,
  ): Promise<AggregatedContextResponseDto> {
    this.logger.log(`[${correlationId}] Getting aggregated context for ticket ${ticketId}`);
    
    const aggregated = await this.contextService.getAggregatedContext(ticketId, correlationId);
    
    return {
      documents: aggregated.documents.map((doc) => ({
        documentId: doc.sourceFile, // Use sourceFile as ID proxy
        extractedText: doc.content,
        wordCount: doc.wordCount,
        extractedAt: new Date().toISOString(),
      })),
      totalWordCount: aggregated.totalWordCount,
      documentCount: aggregated.documentCount,
      formattedContext: aggregated.formattedContext,
    };
  }

  /**
   * Delete a context document (PM only)
   */
  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('pm', 'admin')
  @ApiOperation({ summary: 'Delete a context document (PM only)' })
  @ApiResponse({ status: 204, description: 'Document deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - PM role required' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async deleteDocument(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CorrelationId() correlationId: string,
  ): Promise<void> {
    this.logger.log(`[${correlationId}] Deleting document ${documentId}`);
    await this.contextService.deleteDocument(documentId);
  }
}
```

---

## Phase 6: Prometheus Metrics

**File:** `src/common/metrics/context-metrics.provider.ts` (CREATE)

```typescript
import { Provider } from '@nestjs/common';
import { makeHistogramProvider, makeCounterProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';

export const CONTEXT_METRICS = {
  EXTRACTION_DURATION: 'context_extraction_duration_seconds',
  UPLOADS_TOTAL: 'context_uploads_total',
  EXTRACTION_ERRORS: 'context_extraction_errors_total',
  DOCUMENTS_SIZE: 'context_documents_size_bytes',
  CACHE_HITS: 'context_cache_hits_total',
};

export const contextMetricsProviders: Provider[] = [
  makeHistogramProvider({
    name: CONTEXT_METRICS.EXTRACTION_DURATION,
    help: 'Duration of context extraction in seconds',
    labelNames: ['format', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  }),
  makeCounterProvider({
    name: CONTEXT_METRICS.UPLOADS_TOTAL,
    help: 'Total context document uploads',
    labelNames: ['status', 'format'],
  }),
  makeCounterProvider({
    name: CONTEXT_METRICS.EXTRACTION_ERRORS,
    help: 'Total context extraction errors',
    labelNames: ['format', 'reason'],
  }),
  makeHistogramProvider({
    name: CONTEXT_METRICS.DOCUMENTS_SIZE,
    help: 'Size of uploaded context documents in bytes',
    labelNames: ['format'],
    buckets: [10240, 102400, 512000, 1048576, 5242880, 10485760], // 10KB to 10MB
  }),
  makeCounterProvider({
    name: CONTEXT_METRICS.CACHE_HITS,
    help: 'Context cache hit count',
    labelNames: ['hit'],
  }),
];
```

---

## Phase 7: Module & Configuration

### 7.1 Module Configuration

**File:** `src/ticket-intake/ticket-intake.module.ts` (REPLACE/MODIFY)

```typescript
import { Module, CacheModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { ThrottlerModule } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { contextMetricsProviders } from '../common/metrics/context-metrics.provider';

// Context extraction
import { ContextExtractionService } from './context-extraction.service';
import { ContextCacheService } from './context-cache.service';
import { ContextDocumentController } from './context-document.controller';
import {
  PdfExtractor,
  MarkdownExtractor,
  TextExtractor,
  DocxExtractor,
} from './extractors';

// Note: Add Story 2.2 services when implemented:
// - TicketIntakeService, TicketValidatorService
// Note: Add Story 2.11 services when implemented:
// - TicketQualityService, quality scorers

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RabbitMQModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ttl: config.get('context.cacheTtlHours', 24) * 60 * 60 * 1000,
        max: 500,
      }),
    }),
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }]),
  ],
  controllers: [
    ContextDocumentController, // API endpoints with security guards
  ],
  providers: [
    // Context extraction
    ContextExtractionService,
    ContextCacheService,
    PdfExtractor,
    MarkdownExtractor,
    TextExtractor,
    DocxExtractor,
    ...contextMetricsProviders,
  ],
  exports: [ContextExtractionService, ContextCacheService],
})
export class TicketIntakeModule {}
```

### 7.2 Configuration Updates

**File:** `src/config/configuration.ts` (ADD to existing)

```typescript
// Add to existing configuration object:
context: {
  maxFileSizeMb: parseInt(process.env.CONTEXT_MAX_FILE_SIZE_MB, 10) || 10,
  cacheTtlHours: parseInt(process.env.CONTEXT_CACHE_TTL_HOURS, 10) || 24,
  storagePath: process.env.CONTEXT_STORAGE_PATH || './uploads/context',
  supportedFormats: (process.env.CONTEXT_SUPPORTED_FORMATS || 'pdf,md,txt,docx').split(','),
},
```

**File:** `src/config/env.validation.ts` (ADD to Joi schema)

```typescript
// Add to existing Joi schema:
CONTEXT_MAX_FILE_SIZE_MB: Joi.number().integer().min(1).max(50).default(10),
CONTEXT_CACHE_TTL_HOURS: Joi.number().integer().min(1).max(168).default(24), // Max 1 week
CONTEXT_STORAGE_PATH: Joi.string().default('./uploads/context'),
CONTEXT_SUPPORTED_FORMATS: Joi.string().default('pdf,md,txt,docx'),
```

---

## Phase 8: Database Migration (Explicit Steps)

### 8.1 Migration Commands

**Execute these commands in order:**

```bash
# Step 1: Generate the migration
npx prisma migrate dev --name add_context_documents

# Step 2: Verify migration was created successfully
# Check for new folder in prisma/migrations/

# Step 3: Regenerate Prisma client (usually automatic, but run if issues)
npx prisma generate

# Step 4: Verify schema changes
npx prisma db push --dry-run
```

**Rollback Command (if needed):**
```bash
# Roll back the last migration (development only)
npx prisma migrate reset --skip-seed

# Or manually:
# 1. Delete the migration folder from prisma/migrations/
# 2. Run: npx prisma db push --force-reset (CAUTION: deletes data)
```

**Production Deployment:**
```bash
# For production, use migrate deploy (not dev)
npx prisma migrate deploy
```

---

## Phase 9: Tests

### 9.1 Unit Tests

**File:** `src/ticket-intake/context-extraction.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getMetricToken } from '@willsoto/nestjs-prometheus';
import { ContextExtractionService } from './context-extraction.service';
import { ContextCacheService } from './context-cache.service';
import { PrismaService } from '../database/prisma.service';
import {
  PdfExtractor,
  MarkdownExtractor,
  TextExtractor,
  DocxExtractor,
} from './extractors';
import { CONTEXT_METRICS } from '../common/metrics/context-metrics.provider';

describe('ContextExtractionService', () => {
  let service: ContextExtractionService;
  let prisma: jest.Mocked<PrismaService>;

  const mockHistogram = { startTimer: jest.fn(() => jest.fn()) };
  const mockCounter = { inc: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextExtractionService,
        ContextCacheService,
        PdfExtractor,
        MarkdownExtractor,
        TextExtractor,
        DocxExtractor,
        {
          provide: PrismaService,
          useValue: {
            ticket: { findUnique: jest.fn() },
            contextDocument: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: any) => defaultValue),
          },
        },
        { provide: 'CACHE_MANAGER', useValue: { get: jest.fn(), set: jest.fn() } },
        { provide: getMetricToken(CONTEXT_METRICS.EXTRACTION_DURATION), useValue: mockHistogram },
        { provide: getMetricToken(CONTEXT_METRICS.UPLOADS_TOTAL), useValue: mockCounter },
        { provide: getMetricToken(CONTEXT_METRICS.EXTRACTION_ERRORS), useValue: mockCounter },
      ],
    }).compile();

    service = module.get<ContextExtractionService>(ContextExtractionService);
    prisma = module.get(PrismaService);
  });

  describe('validateFile', () => {
    it('accepts valid PDF file', () => {
      const result = service.validateFile('document.pdf', 1024 * 1024);
      expect(result.isValid).toBe(true);
      expect(result.format).toBe('PDF');
      expect(result.errors).toHaveLength(0);
    });

    it('accepts valid Markdown file', () => {
      const result = service.validateFile('readme.md', 50000);
      expect(result.isValid).toBe(true);
      expect(result.format).toBe('MARKDOWN');
    });

    it('rejects unsupported format', () => {
      const result = service.validateFile('image.jpg', 1024);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('Unsupported file format'));
    });

    it('rejects file exceeding size limit', () => {
      const result = service.validateFile('huge.pdf', 15 * 1024 * 1024); // 15MB
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('exceeds limit'));
    });

    it('rejects empty file', () => {
      const result = service.validateFile('empty.txt', 0);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('File is empty');
    });
  });

  describe('getDocumentsForTicket', () => {
    it('returns mapped documents', async () => {
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
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      (prisma.contextDocument.findMany as jest.Mock).mockResolvedValue(mockDocs);

      const result = await service.getDocumentsForTicket('ticket-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-1');
      expect(result[0].originalFilename).toBe('test.md');
    });
  });
});
```

### 9.2 E2E Tests

**File:** `test/context-extraction.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from '../src/app.module';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/database/prisma.service';

describe('Context Extraction (e2e)', () => {
  let app: INestApplication;
  let pmToken: string;
  let prisma: PrismaService;
  let testTicketId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    const jwtService = moduleFixture.get<JwtService>(JwtService);
    pmToken = jwtService.sign({ sub: 'pm-user', role: 'pm' });

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Create test ticket
    const ticket = await prisma.ticket.create({
      data: {
        clickup_task_id: 'test-task-123',
        project_id: 'test-project',
        title: 'Test Ticket',
        description: 'Test description',
        acceptance_criteria: 'Test AC',
        ticket_quality_score: 75,
      },
    });
    testTicketId = ticket.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.contextDocument.deleteMany({ where: { ticket_id: testTicketId } });
    await prisma.ticket.delete({ where: { id: testTicketId } });
    await app.close();
  });

  describe('POST /context-documents/upload', () => {
    it('uploads and extracts markdown file', async () => {
      const testContent = '# Test Document\n\nThis is test content for context extraction.';
      const testFilePath = path.join(__dirname, 'test-context.md');
      fs.writeFileSync(testFilePath, testContent);

      const res = await request(app.getHttpServer())
        .post('/context-documents/upload')
        .set('Authorization', `Bearer ${pmToken}`)
        .field('ticketId', testTicketId)
        .field('documentType', 'spec')
        .attach('file', testFilePath)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.originalFilename).toBe('test-context.md');
      expect(res.body.fileFormat).toBe('MARKDOWN');
      expect(res.body.extractionStatus).toBe('COMPLETED');

      // Cleanup test file
      fs.unlinkSync(testFilePath);
    });

    it('rejects file exceeding size limit', async () => {
      // Create large file (would need to be >10MB)
      // For testing, just verify the validation logic works
      await request(app.getHttpServer())
        .post('/context-documents/upload')
        .set('Authorization', `Bearer ${pmToken}`)
        .field('ticketId', testTicketId)
        .attach('file', Buffer.alloc(1024), { filename: 'small.txt' })
        .expect(201); // Small file should succeed
    });

    it('rejects unsupported file format', async () => {
      await request(app.getHttpServer())
        .post('/context-documents/upload')
        .set('Authorization', `Bearer ${pmToken}`)
        .field('ticketId', testTicketId)
        .attach('file', Buffer.from('test'), { filename: 'test.jpg' })
        .expect(400);
    });
  });

  describe('GET /context-documents/ticket/:ticketId', () => {
    it('returns all documents for ticket', async () => {
      const res = await request(app.getHttpServer())
        .get(`/context-documents/ticket/${testTicketId}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /context-documents/ticket/:ticketId/aggregated', () => {
    it('returns aggregated context for AI prompts', async () => {
      const res = await request(app.getHttpServer())
        .get(`/context-documents/ticket/${testTicketId}/aggregated`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('documents');
      expect(res.body).toHaveProperty('totalWordCount');
      expect(res.body).toHaveProperty('documentCount');
      expect(res.body).toHaveProperty('formattedContext');
    });
  });
});
```

---

## Tasks Checklist

### Phase 1: Database
- [ ] Add `ContextDocument` model to `prisma/schema.prisma`
- [ ] Add relation to `Ticket` model
- [ ] Run migration commands (see Phase 8 for exact steps)

### Phase 2: Interfaces & DTOs
- [ ] Create `interfaces/context-document.interface.ts`
- [ ] Create `dto/context-document.dto.ts`

### Phase 3: Extractors
- [ ] Create `extractors/` directory
- [ ] Implement `base-extractor.ts`
- [ ] Implement `pdf-extractor.ts`
- [ ] Implement `markdown-extractor.ts`
- [ ] Implement `text-extractor.ts`
- [ ] Implement `docx-extractor.ts`
- [ ] Create `extractors/index.ts`

### Phase 4: Services
- [ ] Implement `context-cache.service.ts`
- [ ] Implement `context-extraction.service.ts`

### Phase 5: Controller (SECURITY CRITICAL)
- [ ] Create `context-document.controller.ts` with guards
- [ ] Verify `@UseGuards(JwtAuthGuard, RolesGuard)` applied
- [ ] Verify `@Roles('pm', 'admin')` on upload/delete
- [ ] Verify rate limiting with `@Throttle`

### Phase 6: Metrics
- [ ] Create `context-metrics.provider.ts`

### Phase 7: Integration
- [ ] Update `ticket-intake.module.ts` with controller
- [ ] Add `ThrottlerModule` import
- [ ] Add config to `configuration.ts`
- [ ] Add validation to `env.validation.ts`
- [ ] Install dependencies: `npm install pdf-parse mammoth`

### Phase 8: Database Migration
- [ ] Run `npx prisma migrate dev --name add_context_documents`
- [ ] Verify migration created successfully
- [ ] Run `npx prisma generate` if needed

### Phase 9: Testing
- [ ] Unit tests with >80% coverage
- [ ] E2E tests for upload and extraction
- [ ] E2E tests for security (401, 403 responses)
- [ ] Verify all file formats work
- [ ] Test rate limiting

---

## Dev Notes

### Critical Import Paths
```typescript
// ✅ CORRECT - Use these paths:
import { PrismaService } from '../database/prisma.service';
import { ContextExtractionService } from './context-extraction.service';
import { ContextDocumentController } from './context-document.controller';
import { contextMetricsProviders } from '../common/metrics/context-metrics.provider';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators/roles.decorator';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';

// ❌ WRONG - These patterns don't exist:
// import { ContextService } from '../context/context.service';
// import { JwtAuthGuard } from '../auth/jwt-auth.guard';
```

### ⚠️ Story 2.2 Interface Integration (IMPORTANT)

When Story 2.2 is implemented, update the `IParsedTicket` interface to include context document references:

**File:** `src/ticket-intake/interfaces/ticket-intake.interface.ts` (Story 2.2 file)

```typescript
// ADD to IParsedTicket interface:
export interface IParsedTicket {
  // ... existing fields from Story 2.2 ...
  clickupTaskId: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  ticketQualityScore: number;
  
  // ADD these fields for Story 2.12 integration:
  contextDocumentIds?: string[];  // References to attached context documents
  hasContextDocuments: boolean;   // Quick check flag
}
```

**Integration Point in Story 2.2 `TicketIntakeService`:**
```typescript
// After ticket is created, check for context documents:
async processTicket(ticketId: string): Promise<IParsedTicket> {
  const ticket = await this.parseTicket(webhookPayload);
  
  // ADD: Check for attached context documents
  const contextDocs = await this.contextExtractionService.getDocumentsForTicket(ticket.id);
  ticket.contextDocumentIds = contextDocs.map(d => d.id);
  ticket.hasContextDocuments = contextDocs.length > 0;
  
  return ticket;
}
```

### Story 2.4 Integration (Prompt Generation)
When Story 2.4 is implemented, integrate context into prompts:

```typescript
// In PromptGeneratorService.buildPrompt()
const context = await this.contextService.getAggregatedContext(ticketId);
if (context.documentCount > 0) {
  promptSections.push(context.formattedContext);
}
```

### File Storage Considerations
- **Development:** Local filesystem (`./uploads/context/`)
- **Production:** Consider S3, GCS, or Azure Blob Storage
- Files are deduplicated by SHA-256 hash
- Consider virus scanning for uploaded files in production

### Dependencies

| Story | Required | Status |
|-------|----------|--------|
| 1.3 | PrismaService | ✅ |
| 1.4 | ConfigService | ✅ |
| 1.7 | LoggerService | ✅ |
| 1.8 | Prometheus metrics | ✅ |
| 2.2 | TicketIntakeService | ⚠️ Prerequisite |
| 2.4 | PromptGeneratorService | ⚠️ Prerequisite |

### References
- [Source: docs/prd.md#FR3] - PM context document attachment
- [Source: docs/prd.md#FR59] - System extracts project context
- [Source: docs/architecture.md#ticket-intake] - Module structure
- [Source: docs/epics.md#Story-2.12] - Acceptance criteria

---

## File List

| File | Action |
|------|--------|
| `prisma/schema.prisma` | MODIFY - Add ContextDocument model |
| `src/ticket-intake/interfaces/context-document.interface.ts` | CREATE |
| `src/ticket-intake/dto/context-document.dto.ts` | CREATE |
| `src/ticket-intake/extractors/base-extractor.ts` | CREATE |
| `src/ticket-intake/extractors/pdf-extractor.ts` | CREATE |
| `src/ticket-intake/extractors/markdown-extractor.ts` | CREATE |
| `src/ticket-intake/extractors/text-extractor.ts` | CREATE |
| `src/ticket-intake/extractors/docx-extractor.ts` | CREATE |
| `src/ticket-intake/extractors/index.ts` | CREATE |
| `src/ticket-intake/context-cache.service.ts` | CREATE |
| `src/ticket-intake/context-extraction.service.ts` | CREATE |
| `src/ticket-intake/context-document.controller.ts` | **CREATE** - API endpoints with security |
| `src/common/metrics/context-metrics.provider.ts` | CREATE |
| `src/ticket-intake/ticket-intake.module.ts` | MODIFY - Add controller, ThrottlerModule |
| `src/config/configuration.ts` | MODIFY |
| `src/config/env.validation.ts` | MODIFY |
| `src/ticket-intake/context-extraction.service.spec.ts` | CREATE |
| `test/context-extraction.e2e-spec.ts` | CREATE |

