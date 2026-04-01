/**
 * Anthropic Tool Definitions
 * Story 2.7: AI Provider Integration - Claude Code (Anthropic)
 *
 * Defines the tools Claude can use for file operations.
 * These enable autonomous coding capabilities.
 *
 * Reference: https://docs.anthropic.com/claude/docs/tool-use
 */

import { Tool } from '@anthropic-ai/sdk/resources/messages';

/**
 * Tool: Read file contents
 */
export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file from the workspace',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to the file to read',
      },
    },
    required: ['path'],
  },
};

/**
 * Tool: Write/create file
 */
export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write or create a file in the workspace',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
};

/**
 * Tool: Edit existing file with search/replace
 */
export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Edit an existing file by replacing specific content',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to the file to edit',
      },
      old_content: {
        type: 'string',
        description: 'The exact content to find and replace',
      },
      new_content: {
        type: 'string',
        description: 'The new content to replace with',
      },
    },
    required: ['path', 'old_content', 'new_content'],
  },
};

/**
 * Tool: List files in directory
 */
export const listFilesTool: Tool = {
  name: 'list_files',
  description: 'List files in a directory',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list (default: workspace root)',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list recursively',
      },
    },
    required: [],
  },
};

/**
 * Tool: Delete file
 */
export const deleteFileTool: Tool = {
  name: 'delete_file',
  description: 'Delete a file from the workspace',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to the file to delete',
      },
    },
    required: ['path'],
  },
};

/**
 * Tool: Generate conventional commit message from code changes
 * Generates AI-powered commit messages for code changes.
 */
export const generateCommitMessageTool: Tool = {
  name: 'generate_commit_message',
  description:
    'Generate a conventional commit message for code changes based on the diff and ticket context',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['feat', 'fix', 'refactor', 'docs', 'test', 'chore', 'perf'],
        description: 'Conventional commit type inferred from the changes',
      },
      scope: {
        type: 'string',
        description:
          'Component scope inferred from the changed files (e.g., auth, api, ui, database)',
      },
      subject: {
        type: 'string',
        description:
          'Concise description of the change in imperative mood, lowercase, no trailing period (max 72 chars)',
      },
      body: {
        type: 'string',
        description:
          'Detailed multi-line description of what changed and why. Include key technical decisions, affected components, and any breaking changes.',
      },
    },
    required: ['type', 'scope', 'subject', 'body'],
  },
};

/**
 * All available tools for Claude
 */
export const codeEditingTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  deleteFileTool,
];

/**
 * Tool input types for type-safe tool handling
 */
export interface ReadFileInput {
  path: string;
}

export interface WriteFileInput {
  path: string;
  content: string;
}

export interface EditFileInput {
  path: string;
  old_content: string;
  new_content: string;
}

export interface ListFilesInput {
  path?: string;
  recursive?: boolean;
}

export interface DeleteFileInput {
  path: string;
}

export interface GenerateCommitMessageInput {
  type: 'feat' | 'fix' | 'refactor' | 'docs' | 'test' | 'chore' | 'perf';
  scope: string;
  subject: string;
  body: string;
}

/**
 * Tool result type
 */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}
