/**
 * Context Document Interfaces - Story 2.12
 * FR3: PMs can attach context documents (client history, domain knowledge)
 * FR59: System can extract project context from ticket metadata
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

/**
 * Complete context document entity
 */
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

/**
 * Extracted content from a document
 */
export interface IExtractedContent {
  text: string;
  title?: string;
  metadata?: Record<string, unknown>;
  wordCount: number;
  pageCount?: number;
  extractedAt: string;
}

/**
 * Result of an extraction operation
 */
export interface IExtractionResult {
  success: boolean;
  content?: IExtractedContent;
  error?: string;
  durationMs: number;
}

/**
 * Single document formatted for prompt injection
 */
export interface IContextForPrompt {
  documentTitle: string;
  documentType: string;
  content: string;
  wordCount: number;
  sourceFile: string;
}

/**
 * Aggregated context from all documents for a ticket
 */
export interface IAggregatedContext {
  documents: IContextForPrompt[];
  totalWordCount: number;
  documentCount: number;
  formattedContext: string; // Ready to inject into prompts
}

/**
 * Extractor interface that all format extractors must implement
 */
export interface IExtractor {
  readonly supportedFormat: ContextFileFormat;
  extract(filePath: string): Promise<IExtractionResult>;
  canExtract(filePath: string): boolean;
}

/**
 * File validation result
 */
export interface IFileValidation {
  isValid: boolean;
  format?: ContextFileFormat;
  errors: string[];
}

/**
 * MIME types for supported formats
 */
export const SUPPORTED_MIME_TYPES: Record<ContextFileFormat, string[]> = {
  [ContextFileFormat.PDF]: ['application/pdf'],
  [ContextFileFormat.MARKDOWN]: ['text/markdown', 'text/x-markdown'],
  [ContextFileFormat.TEXT]: ['text/plain'],
  [ContextFileFormat.DOCX]: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
};

/**
 * File extension to format mapping
 */
export const FILE_EXTENSIONS: Record<string, ContextFileFormat> = {
  '.pdf': ContextFileFormat.PDF,
  '.md': ContextFileFormat.MARKDOWN,
  '.markdown': ContextFileFormat.MARKDOWN,
  '.txt': ContextFileFormat.TEXT,
  '.text': ContextFileFormat.TEXT,
  '.docx': ContextFileFormat.DOCX,
};

/**
 * Maximum file size in bytes (10MB)
 */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
