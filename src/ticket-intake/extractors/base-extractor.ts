import { Logger } from '@nestjs/common';
import * as path from 'path';
import { safeReadFileBuffer } from '../../common/utils/safe-fs.util';
import {
  IExtractor,
  IExtractionResult,
  ContextFileFormat,
} from '../interfaces/context-document.interface';

/**
 * Abstract base class for document extractors
 * Story 2.12: Project Context Extraction
 */
export abstract class BaseExtractor implements IExtractor {
  protected readonly logger: Logger;
  abstract readonly supportedFormat: ContextFileFormat;

  constructor(loggerContext: string) {
    this.logger = new Logger(loggerContext);
  }

  /**
   * Extract content from a file
   */
  abstract extract(filePath: string): Promise<IExtractionResult>;

  /**
   * Check if this extractor can process the given file
   */
  canExtract(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.getSupportedExtensions().includes(ext);
  }

  /**
   * Get supported file extensions for this extractor
   */
  protected abstract getSupportedExtensions(): string[];

  /**
   * Read file as buffer using validated path within filesystem root
   */
  protected async readFile(filePath: string): Promise<Buffer> {
    // Use filesystem root as allowed root since paths come from validated database
    const fsRoot = path.parse(filePath).root;
    return safeReadFileBuffer(filePath, fsRoot);
  }

  /**
   * Count words in text
   */
  protected countWords(text: string): number {
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  }

  /**
   * Extract title from text content or filename
   */
  protected extractTitle(text: string, filename: string): string {
    // Try to extract from first heading (markdown style)
    const headingMatch = text.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }

    // Try first meaningful line
    const firstLineMatch = text.match(/^(.{1,100})/);
    if (firstLineMatch && firstLineMatch[1].trim().length > 5) {
      return firstLineMatch[1].trim().substring(0, 100);
    }

    // Fallback to filename without extension
    return path.basename(filename, path.extname(filename));
  }

  /**
   * Create a success extraction result
   */
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

  /**
   * Create an error extraction result
   */
  protected createErrorResult(error: string, durationMs: number): IExtractionResult {
    return {
      success: false,
      error,
      durationMs,
    };
  }
}
