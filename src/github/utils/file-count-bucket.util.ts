export function getFileCountBucket(fileCount: number): string {
  if (fileCount === 0) return 'empty'; // E2: Handle empty commits
  if (fileCount <= 5) return '1-5';
  if (fileCount <= 20) return '6-20';
  if (fileCount <= 50) return '21-50';
  if (fileCount <= 100) return '51-100';
  return '100+';
}
