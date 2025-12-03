import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ContextFileFormat,
  ExtractionStatus,
} from '../interfaces/context-document.interface';

/**
 * DTO for uploading a context document
 * FR3: PMs can attach context documents
 */
export class UploadContextDocumentDto {
  @ApiProperty({
    description: 'Ticket ID to attach document to',
    format: 'uuid',
  })
  @IsUUID()
  ticketId!: string;

  @ApiPropertyOptional({
    description: 'Document type classification (e.g., spec, requirements, domain)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentType?: string;

  @ApiPropertyOptional({
    description: 'Custom document title (extracted from content if not provided)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  documentTitle?: string;
}

/**
 * Response DTO for context document operations
 */
export class ContextDocumentResponseDto {
  @ApiProperty({ description: 'Document ID' })
  id!: string;

  @ApiProperty({ description: 'Associated ticket ID' })
  ticketId!: string;

  @ApiProperty({ description: 'Original filename of the uploaded file' })
  originalFilename!: string;

  @ApiProperty({
    enum: ContextFileFormat,
    description: 'File format (PDF, MARKDOWN, TEXT, DOCX)',
  })
  fileFormat!: ContextFileFormat;

  @ApiProperty({ description: 'File size in bytes' })
  fileSizeBytes!: number;

  @ApiProperty({
    enum: ExtractionStatus,
    description: 'Status of text extraction',
  })
  extractionStatus!: ExtractionStatus;

  @ApiPropertyOptional({ description: 'Document title' })
  documentTitle?: string;

  @ApiPropertyOptional({ description: 'Document type classification' })
  documentType?: string;

  @ApiPropertyOptional({ description: 'Error message if extraction failed' })
  extractionError?: string;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: string;
}

/**
 * Response DTO for extracted content
 */
export class ExtractedContentResponseDto {
  @ApiProperty({ description: 'Document ID' })
  documentId!: string;

  @ApiProperty({ description: 'Extracted text content' })
  extractedText!: string;

  @ApiProperty({ description: 'Word count of extracted text' })
  wordCount!: number;

  @ApiPropertyOptional({ description: 'Page count (for PDFs)' })
  pageCount?: number;

  @ApiProperty({ description: 'Extraction timestamp' })
  extractedAt!: string;
}

/**
 * Response DTO for aggregated context (FR59)
 */
export class AggregatedContextResponseDto {
  @ApiProperty({
    type: [ExtractedContentResponseDto],
    description: 'List of extracted documents',
  })
  documents!: ExtractedContentResponseDto[];

  @ApiProperty({ description: 'Total word count across all documents' })
  totalWordCount!: number;

  @ApiProperty({ description: 'Number of documents' })
  documentCount!: number;

  @ApiProperty({ description: 'Formatted context ready for AI prompts' })
  formattedContext!: string;
}

/**
 * Response DTO for bulk upload operations
 */
export class BulkUploadResultDto {
  @ApiProperty({ description: 'Total files attempted' })
  totalFiles!: number;

  @ApiProperty({ description: 'Successfully uploaded count' })
  successCount!: number;

  @ApiProperty({ description: 'Failed upload count' })
  failedCount!: number;

  @ApiProperty({
    type: [ContextDocumentResponseDto],
    description: 'Successfully uploaded documents',
  })
  uploaded!: ContextDocumentResponseDto[];

  @ApiProperty({
    description: 'Failed uploads with error messages',
  })
  errors!: Array<{ filename: string; error: string }>;
}

/**
 * Internal DTO for extraction job processing
 */
export class ExtractionJobDto {
  @IsUUID()
  documentId!: string;

  @IsString()
  filePath!: string;

  @IsEnum(ContextFileFormat)
  format!: ContextFileFormat;

  @IsOptional()
  @IsString()
  correlationId?: string;
}
