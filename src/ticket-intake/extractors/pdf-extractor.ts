import { Injectable } from '@nestjs/common';
import { BaseExtractor } from './base-extractor';
import {
  IExtractionResult,
  ContextFileFormat,
} from '../interfaces/context-document.interface';

/**
 * PDF text extractor using pdf-parse
 * Story 2.12: Project Context Extraction - PDF format support
 */
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
      // Dynamic import to avoid issues if pdf-parse is not installed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`PDF extraction failed: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      return this.createErrorResult(
        `PDF extraction failed: ${errorMessage}`,
        Date.now() - startTime,
      );
    }
  }
}
