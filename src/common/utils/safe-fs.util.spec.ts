import * as path from 'path';
import { validatePath, sanitizePathComponent, buildSafePath } from './safe-fs.util';

describe('safe-fs.util', () => {
  describe('validatePath', () => {
    it('should allow paths within the root directory', () => {
      const root = '/home/user/workspace';
      const filePath = '/home/user/workspace/subdir/file.txt';

      expect(validatePath(filePath, root)).toBe(filePath);
    });

    it('should allow the root directory itself', () => {
      const root = '/home/user/workspace';

      expect(validatePath(root, root)).toBe(root);
    });

    it('should throw on path traversal attempts', () => {
      const root = '/home/user/workspace';
      const maliciousPath = '/home/user/workspace/../../../etc/passwd';

      expect(() => validatePath(maliciousPath, root)).toThrow('Path traversal detected');
    });

    it('should throw for paths outside root', () => {
      const root = '/home/user/workspace';
      const outsidePath = '/home/user/other/file.txt';

      expect(() => validatePath(outsidePath, root)).toThrow('Path traversal detected');
    });

    it('should handle relative paths correctly', () => {
      const root = process.cwd();
      const relativePath = path.join(root, 'subdir', 'file.txt');

      expect(validatePath(relativePath, root)).toBe(relativePath);
    });

    it('should allow any absolute path when root is filesystem root', () => {
      const root = '/';
      const filePath = '/tmp/test-workspaces/some-file.txt';

      expect(validatePath(filePath, root)).toBe(filePath);
    });

    it('should allow nested paths when root is filesystem root', () => {
      const root = '/';
      const filePath = '/var/lib/some/deeply/nested/path/file.txt';

      expect(validatePath(filePath, root)).toBe(filePath);
    });
  });

  describe('sanitizePathComponent', () => {
    it('should remove forward slashes', () => {
      expect(sanitizePathComponent('file/name')).toBe('file_name');
    });

    it('should remove backslashes', () => {
      expect(sanitizePathComponent('file\\name')).toBe('file_name');
    });

    it('should remove null bytes', () => {
      expect(sanitizePathComponent('file\0name')).toBe('filename');
    });

    it('should replace .. with __', () => {
      expect(sanitizePathComponent('..parent')).toBe('__parent');
    });

    it('should handle ../ by replacing both', () => {
      // ../ becomes __ (for ..) + _ (for /) = ___
      expect(sanitizePathComponent('../parent')).toBe('___parent');
    });

    it('should handle multiple issues', () => {
      // ../ = ___, file/name = file_name
      expect(sanitizePathComponent('../file/name\0.txt')).toBe('___file_name.txt');
    });

    it('should preserve safe characters', () => {
      expect(sanitizePathComponent('my-file_v2.txt')).toBe('my-file_v2.txt');
    });
  });

  describe('buildSafePath', () => {
    it('should build a safe path from components', () => {
      const root = '/home/user/workspace';
      const result = buildSafePath(root, 'subdir', 'file.txt');

      expect(result).toBe(path.join(root, 'subdir', 'file.txt'));
    });

    it('should sanitize path components with slashes', () => {
      const root = '/home/user/workspace';
      const result = buildSafePath(root, 'sub/dir', 'file.txt');

      expect(result).toBe(path.join(root, 'sub_dir', 'file.txt'));
    });

    it('should prevent traversal attempts', () => {
      const root = '/home/user/workspace';

      expect(() => buildSafePath(root, '..', 'etc', 'passwd')).not.toThrow();
      // The .. gets sanitized to __ before path resolution
      const result = buildSafePath(root, '..', 'etc', 'passwd');
      expect(result).toBe(path.join(root, '__', 'etc', 'passwd'));
    });
  });
});
