import { Injectable } from '@nestjs/common';
import { BaseExtractor } from './base-extractor';
import { IExtractionResult, ContextFileFormat } from '../interfaces/context-document.interface';

/**
 * DOCX text extractor using mammoth
 * Story 2.12: Project Context Extraction - DOCX format support
 */
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
      // Dynamic import to avoid issues if mammoth is not installed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth');

      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value.trim();

      if (!text || text.length === 0) {
        return this.createErrorResult('DOCX contains no text', Date.now() - startTime);
      }

      // Log any conversion messages/warnings
      if (result.messages && result.messages.length > 0) {
        this.logger.warn(
          `DOCX conversion messages: ${result.messages.map((m: { message: string }) => m.message).join(', ')}`,
        );
      }

      const title = this.extractTitle(text, filePath);

      return this.createSuccessResult(text, title, Date.now() - startTime, {
        warnings: result.messages?.map((m: { message: string }) => m.message) || [],
      });
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';
      this.logger.error(
        `DOCX extraction failed: ${errorMessage}`,
        _error instanceof Error ? _error.stack : undefined,
      );
      return this.createErrorResult(
        `DOCX extraction failed: ${errorMessage}`,
        Date.now() - startTime,
      );
    }
  }
}
