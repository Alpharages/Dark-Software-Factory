import { getFileCountBucket } from './file-count-bucket.util';

describe('getFileCountBucket', () => {
  it('should return "empty" for 0 files', () => {
    expect(getFileCountBucket(0)).toBe('empty');
  });

  it('should return "1-5" for 1-5 files', () => {
    expect(getFileCountBucket(1)).toBe('1-5');
    expect(getFileCountBucket(5)).toBe('1-5');
  });

  it('should return "6-20" for 6-20 files', () => {
    expect(getFileCountBucket(6)).toBe('6-20');
    expect(getFileCountBucket(20)).toBe('6-20');
  });

  it('should return "21-50" for 21-50 files', () => {
    expect(getFileCountBucket(21)).toBe('21-50');
    expect(getFileCountBucket(50)).toBe('21-50');
  });

  it('should return "51-100" for 51-100 files', () => {
    expect(getFileCountBucket(51)).toBe('51-100');
    expect(getFileCountBucket(100)).toBe('51-100');
  });

  it('should return "100+" for >100 files', () => {
    expect(getFileCountBucket(101)).toBe('100+');
    expect(getFileCountBucket(1000)).toBe('100+');
  });
});
