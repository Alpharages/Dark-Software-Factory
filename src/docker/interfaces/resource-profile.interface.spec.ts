/**
 * Unit tests for Resource Profile Interface
 * Story 23.3: Resource Limit Enforcement
 */

import {
  ResourceProfile,
  DEFAULT_RESOURCE_PROFILES,
  getResourceProfile,
  mbToBytes,
  cpuPercentToQuota,
} from './resource-profile.interface';

describe('Resource Profile Interface', () => {
  describe('mbToBytes', () => {
    it('should convert MB to bytes correctly', () => {
      expect(mbToBytes(0)).toBe(0);
      expect(mbToBytes(1)).toBe(1048576);
      expect(mbToBytes(256)).toBe(268435456);
      expect(mbToBytes(512)).toBe(536870912);
      expect(mbToBytes(1024)).toBe(1073741824);
    });

    it('should handle decimal MB values', () => {
      expect(mbToBytes(0.5)).toBe(524288);
      expect(mbToBytes(1.5)).toBe(1572864);
    });
  });

  describe('cpuPercentToQuota', () => {
    it('should convert 100% CPU to quota 100000', () => {
      const result = cpuPercentToQuota(100);
      expect(result.cpuQuota).toBe(100000);
      expect(result.cpuPeriod).toBe(100000);
    });

    it('should convert 50% CPU to quota 50000', () => {
      const result = cpuPercentToQuota(50);
      expect(result.cpuQuota).toBe(50000);
      expect(result.cpuPeriod).toBe(100000);
    });

    it('should convert 200% CPU to quota 200000', () => {
      const result = cpuPercentToQuota(200);
      expect(result.cpuQuota).toBe(200000);
      expect(result.cpuPeriod).toBe(100000);
    });

    it('should handle 0% CPU', () => {
      const result = cpuPercentToQuota(0);
      expect(result.cpuQuota).toBe(0);
      expect(result.cpuPeriod).toBe(100000);
    });

    it('should round to nearest integer', () => {
      const result = cpuPercentToQuota(33.33);
      expect(result.cpuQuota).toBe(33330);
    });
  });

  describe('DEFAULT_RESOURCE_PROFILES', () => {
    it('should have correct small profile values', () => {
      const profile = DEFAULT_RESOURCE_PROFILES.small;
      expect(profile.memoryLimitMB).toBe(256);
      expect(profile.cpuLimitPercent).toBe(50);
      expect(profile.swapLimitMB).toBe(256);
    });

    it('should have correct medium profile values', () => {
      const profile = DEFAULT_RESOURCE_PROFILES.medium;
      expect(profile.memoryLimitMB).toBe(512);
      expect(profile.cpuLimitPercent).toBe(100);
      expect(profile.swapLimitMB).toBe(512);
    });

    it('should have correct large profile values', () => {
      const profile = DEFAULT_RESOURCE_PROFILES.large;
      expect(profile.memoryLimitMB).toBe(1024);
      expect(profile.cpuLimitPercent).toBe(200);
      expect(profile.swapLimitMB).toBe(1024);
    });

    it('should have zero values for custom profile', () => {
      const profile = DEFAULT_RESOURCE_PROFILES.custom;
      expect(profile.memoryLimitMB).toBe(0);
      expect(profile.cpuLimitPercent).toBe(0);
      expect(profile.swapLimitMB).toBe(0);
    });
  });

  describe('getResourceProfile', () => {
    it('should return small profile', () => {
      const profile = getResourceProfile('small');
      expect(profile).toEqual(DEFAULT_RESOURCE_PROFILES.small);
    });

    it('should return medium profile', () => {
      const profile = getResourceProfile('medium');
      expect(profile).toEqual(DEFAULT_RESOURCE_PROFILES.medium);
    });

    it('should return large profile', () => {
      const profile = getResourceProfile('large');
      expect(profile).toEqual(DEFAULT_RESOURCE_PROFILES.large);
    });

    it('should return custom profile', () => {
      const profile = getResourceProfile('custom');
      expect(profile).toEqual(DEFAULT_RESOURCE_PROFILES.custom);
    });

    it('should default to medium for unknown profile', () => {
      const profile = getResourceProfile('unknown' as ResourceProfile);
      expect(profile).toEqual(DEFAULT_RESOURCE_PROFILES.medium);
    });
  });
});
