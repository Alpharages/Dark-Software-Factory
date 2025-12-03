import { Injectable } from '@nestjs/common';
import { BaseExtractor } from './base-extractor';
import {
  IExtractionResult,
  ContextFileFormat,
} from '../interfaces/context-document.interface';

/**
 * Markdown text extractor
 * Story 2.12: Project Context Extraction - Markdown format support
 */
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Markdown extraction failed: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      return this.createErrorResult(
        `Markdown extraction failed: ${errorMessage}`,
        Date.now() - startTime,
      );
    }
  }
}
