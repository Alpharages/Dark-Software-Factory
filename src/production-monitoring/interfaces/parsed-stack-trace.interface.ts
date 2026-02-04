/**
 * Parsed Stack Trace Interfaces
 * Story 9-U-4: Error Context Extraction & Linking
 */

export interface StackTraceFrame {
  /** Source file path */
  file: string;
  /** Line number in the file */
  line: number;
  /** Column number (optional) */
  column?: number;
  /** Function/method name */
  function: string;
  /** Source code context (if available from source maps) */
  source_context?: string;
}

export interface ParsedStackTrace {
  /** Array of parsed frames */
  frames: StackTraceFrame[];
  /** Most likely source of error (top frame) */
  top_frame: StackTraceFrame;
  /** Entry point (bottom frame) */
  entry_frame: StackTraceFrame;
  /** Raw stack trace string */
  raw: string;
}
