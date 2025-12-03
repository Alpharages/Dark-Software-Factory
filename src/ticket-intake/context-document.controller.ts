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
  NotFoundException,
  BadRequestException,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
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
import { Roles, CorrelationId } from '../common/decorators';
import { ContextExtractionService } from './context-extraction.service';
import {
  UploadContextDocumentDto,
  ContextDocumentResponseDto,
  AggregatedContextResponseDto,
} from './dto/context-document.dto';

/**
 * Context Document Controller - Story 2.12
 * FR3: PMs can attach context documents (PDF, MD, TXT, DOCX)
 * FR59: System extracts project context for AI prompts
 *
 * Security: JwtAuthGuard + RolesGuard + ThrottlerGuard
 * - Upload/Delete: PM or Admin only
 * - Read: PM, Admin, Developer, System
 */
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
  @ApiOperation({ summary: 'Upload context document (PM/Admin only) - FR3' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'ticketId'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF, MD, TXT, or DOCX file (max 10MB)',
        },
        ticketId: {
          type: 'string',
          format: 'uuid',
          description: 'Ticket ID to attach document to',
        },
        documentType: {
          type: 'string',
          description: 'Document type classification (e.g., spec, requirements)',
        },
        documentTitle: {
          type: 'string',
          description: 'Custom document title',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Document uploaded and extracted',
    type: ContextDocumentResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file format or size exceeded' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - PM/Admin role required' })
  @ApiResponse({ status: 404, description: 'Ticket not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async uploadDocument(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
          new FileTypeValidator({
            fileType: /(pdf|text\/plain|text\/markdown|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)/,
          }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
      }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadContextDocumentDto,
    @CorrelationId() correlationId: string,
  ): Promise<ContextDocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    this.logger.log(
      `[${correlationId}] Uploading document for ticket ${dto.ticketId}`,
    );

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
    this.logger.debug(
      `[${correlationId}] Fetching documents for ticket ${ticketId}`,
    );

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
    this.logger.log(
      `[${correlationId}] Getting aggregated context for ticket ${ticketId}`,
    );

    const aggregated = await this.contextService.getAggregatedContext(
      ticketId,
      correlationId,
    );

    return {
      documents: aggregated.documents.map((doc, index) => ({
        documentId: `doc-${index}`, // Note: Full document IDs available via /ticket/:ticketId endpoint
        extractedText: doc.content,
        wordCount: doc.wordCount,
        pageCount: undefined,
        extractedAt: new Date().toISOString(),
      })),
      totalWordCount: aggregated.totalWordCount,
      documentCount: aggregated.documentCount,
      formattedContext: aggregated.formattedContext,
    };
  }

  /**
   * Get a single context document by ID
   */
  @Get(':documentId')
  @Roles('pm', 'admin', 'developer')
  @ApiOperation({ summary: 'Get a single context document' })
  @ApiResponse({ status: 200, type: ContextDocumentResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getDocument(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CorrelationId() correlationId: string,
  ): Promise<ContextDocumentResponseDto> {
    this.logger.debug(`[${correlationId}] Fetching document ${documentId}`);

    const document = await this.contextService.getDocument(documentId);

    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

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
   * Delete a context document (PM/Admin only)
   */
  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('pm', 'admin')
  @ApiOperation({ summary: 'Delete a context document (PM/Admin only)' })
  @ApiResponse({ status: 204, description: 'Document deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - PM/Admin role required' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async deleteDocument(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CorrelationId() correlationId: string,
  ): Promise<void> {
    this.logger.log(`[${correlationId}] Deleting document ${documentId}`);
    await this.contextService.deleteDocument(documentId);
  }
}
