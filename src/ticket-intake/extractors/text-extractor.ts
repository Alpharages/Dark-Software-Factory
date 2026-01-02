import { Injectable } from '@nestjs/common';
import { BaseExtractor } from './base-extractor';
import { IExtractionResult, ContextFileFormat } from '../interfaces/context-document.interface';

/**
 * Plain text extractor
 * Story 2.12: Project Context Extraction - TXT format support
 */
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
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';
      this.logger.error(
        `Text extraction failed: ${errorMessage}`,
        _error instanceof Error ? _error.stack : undefined,
      );
      return this.createErrorResult(
        `Text extraction failed: ${errorMessage}`,
        Date.now() - startTime,
      );
    }
  }
}
