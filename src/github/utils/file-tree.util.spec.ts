import {
  validateFilePath,
  validateFileSize,
  encodeToBase64,
  determineFileMode,
  buildTreeEntries,
  getFileType,
  calculateTotalSize,
  validateAllFilePaths,
  validateAllFileSizes,
  MAX_FILE_SIZE_BYTES,
} from './file-tree.util';
import { FileChange } from '../interfaces/file-change.interface';

describe('FileTreeUtil', () => {
  describe('validateFilePath', () => {
    it('should accept valid file paths', () => {
      expect(validateFilePath('src/auth/auth.service.ts').valid).toBe(true);
      expect(validateFilePath('test/unit/auth.spec.ts').valid).toBe(true);
      expect(validateFilePath('docs/README.md').valid).toBe(true);
    });

    it('should reject path traversal attempts', () => {
      expect(validateFilePath('../../../etc/passwd').valid).toBe(false);
      expect(validateFilePath('src/../../../etc/passwd').valid).toBe(false);
      expect(validateFilePath('~/secret.key').valid).toBe(false);
    });

    it('should reject absolute paths', () => {
      expect(validateFilePath('/etc/passwd').valid).toBe(false);
      expect(validateFilePath('C:\\Windows\\System32').valid).toBe(false);
    });

    it('should reject paths outside allowed directories', () => {
      expect(validateFilePath('node_modules/package.json').valid).toBe(false);
      expect(validateFilePath('secrets/api-key.txt').valid).toBe(false);
    });
  });

  describe('validateFileSize', () => {
    it('should accept files under limit', () => {
      expect(validateFileSize(1000).valid).toBe(true);
      expect(validateFileSize(50 * 1024 * 1024).valid).toBe(true);
    });

    it('should reject files over 100 MB limit', () => {
      const result = validateFileSize(MAX_FILE_SIZE_BYTES + 1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds GitHub limit');
    });
  });

  describe('encodeToBase64', () => {
    it('should encode UTF-8 content to base64', () => {
      const content = 'Hello, World!';
      const encoded = encodeToBase64(content, 'utf-8');
      expect(Buffer.from(encoded, 'base64').toString('utf-8')).toBe(content);
    });

    it('should return base64 content unchanged', () => {
      const base64Content = 'SGVsbG8sIFdvcmxkIQ==';
      expect(encodeToBase64(base64Content, 'base64')).toBe(base64Content);
    });
  });

  describe('determineFileMode', () => {
    it('should return executable mode for script files', () => {
      expect(determineFileMode('script.sh')).toBe('100755');
      expect(determineFileMode('deploy.bash')).toBe('100755');
      expect(determineFileMode('run.py')).toBe('100755');
    });

    it('should return regular mode for non-executable files', () => {
      expect(determineFileMode('index.ts')).toBe('100644');
      expect(determineFileMode('README.md')).toBe('100644');
      expect(determineFileMode('config.json')).toBe('100644');
    });
  });

  describe('buildTreeEntries', () => {
    it('should build tree entries from file changes', () => {
      const files: FileChange[] = [
        { path: 'src/test.ts', operation: 'create', content: 'test', encoding: 'utf-8' },
        { path: 'src/main.ts', operation: 'modify', content: 'main', encoding: 'utf-8' },
      ];

      const blobShas = new Map([
        ['src/test.ts', 'blob-sha-1'],
        ['src/main.ts', 'blob-sha-2'],
      ]);

      const entries = buildTreeEntries(files, blobShas);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        path: 'src/test.ts',
        mode: '100644',
        type: 'blob',
        sha: 'blob-sha-1',
      });
    });

    it('should skip deleted files', () => {
      const files: FileChange[] = [
        { path: 'src/test.ts', operation: 'delete', content: '', encoding: 'utf-8' },
        { path: 'src/main.ts', operation: 'create', content: 'main', encoding: 'utf-8' },
      ];

      const blobShas = new Map([['src/main.ts', 'blob-sha-1']]);

      const entries = buildTreeEntries(files, blobShas);

      expect(entries).toHaveLength(1);
      expect(entries[0].path).toBe('src/main.ts');
    });

    it('should throw if blob SHA not found', () => {
      const files: FileChange[] = [
        { path: 'src/test.ts', operation: 'create', content: 'test', encoding: 'utf-8' },
      ];

      const blobShas = new Map();

      expect(() => buildTreeEntries(files, blobShas)).toThrow('Blob SHA not found');
    });
  });

  describe('getFileType', () => {
    it('should extract file extension', () => {
      expect(getFileType('file.ts')).toBe('ts');
      expect(getFileType('package.json')).toBe('json');
      expect(getFileType('README.md')).toBe('md');
    });

    it('should return filename for files without extension', () => {
      expect(getFileType('Makefile')).toBe('Makefile');
      expect(getFileType('README')).toBe('README');
    });
  });

  describe('calculateTotalSize', () => {
    it('should calculate total size of UTF-8 files', () => {
      const files: FileChange[] = [
        { path: 'test1.ts', operation: 'create', content: 'Hello', encoding: 'utf-8' },
        { path: 'test2.ts', operation: 'create', content: 'World', encoding: 'utf-8' },
      ];

      const size = calculateTotalSize(files);
      expect(size).toBe(10); // 5 + 5
    });

    it('should calculate total size of base64 files', () => {
      const files: FileChange[] = [
        {
          path: 'img.png',
          operation: 'create',
          content: Buffer.from('binary data').toString('base64'),
          encoding: 'base64',
        },
      ];

      const size = calculateTotalSize(files);
      expect(size).toBeGreaterThan(0);
    });
  });

  describe('validateAllFilePaths', () => {
    it('should validate all valid paths', () => {
      const files: FileChange[] = [
        { path: 'src/test.ts', operation: 'create', content: '', encoding: 'utf-8' },
        { path: 'docs/README.md', operation: 'create', content: '', encoding: 'utf-8' },
      ];

      const result = validateAllFilePaths(files);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect errors for invalid paths', () => {
      const files: FileChange[] = [
        { path: '../etc/passwd', operation: 'create', content: '', encoding: 'utf-8' },
        { path: '/etc/hosts', operation: 'create', content: '', encoding: 'utf-8' },
      ];

      const result = validateAllFilePaths(files);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateAllFileSizes', () => {
    it('should validate all files under size limit', () => {
      const files: FileChange[] = [
        { path: 'src/small.ts', operation: 'create', content: 'small content', encoding: 'utf-8' },
      ];

      const result = validateAllFileSizes(files);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect files over size limit', () => {
      const largeContent = 'a'.repeat(MAX_FILE_SIZE_BYTES + 100);
      const files: FileChange[] = [
        { path: 'src/huge.ts', operation: 'create', content: largeContent, encoding: 'utf-8' },
      ];

      const result = validateAllFileSizes(files);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
