import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SandboxResourceProfileService } from './sandbox-resource-profile.service';

describe('SandboxResourceProfileService', () => {
  let service: SandboxResourceProfileService;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        SandboxResourceProfileService,
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    service = module.get(SandboxResourceProfileService);
  });

  afterEach(() => jest.resetAllMocks());

  it('T1: score 0 returns small profile', () => {
    expect(service.getProfile(0)).toEqual({ cpuLimit: '0.5', memoryLimit: '256Mi' });
  });

  it('T2: score 3 returns small profile', () => {
    expect(service.getProfile(3)).toEqual({ cpuLimit: '0.5', memoryLimit: '256Mi' });
  });

  it('T3: score 4 returns medium profile (no overrides)', () => {
    configGet.mockImplementation((key, defaultValue) => defaultValue);
    expect(service.getProfile(4)).toEqual({ cpuLimit: '1', memoryLimit: '512Mi' });
  });

  it('T4: score 7 returns medium profile (no overrides)', () => {
    configGet.mockImplementation((key, defaultValue) => defaultValue);
    expect(service.getProfile(7)).toEqual({ cpuLimit: '1', memoryLimit: '512Mi' });
  });

  it('T5: score 5 with env overrides returns overridden medium profile', () => {
    configGet.mockImplementation((key) => {
      if (key === 'opensandbox.defaultCpuLimit') return '2';
      if (key === 'opensandbox.defaultMemoryLimit') return '1Gi';
      return null;
    });
    expect(service.getProfile(5)).toEqual({ cpuLimit: '2', memoryLimit: '1Gi' });
  });

  it('T6: score 8 returns large profile', () => {
    expect(service.getProfile(8)).toEqual({ cpuLimit: '2', memoryLimit: '1Gi' });
    expect(configGet).not.toHaveBeenCalled();
  });

  it('T7: score 10 returns large profile', () => {
    expect(service.getProfile(10)).toEqual({ cpuLimit: '2', memoryLimit: '1Gi' });
    expect(configGet).not.toHaveBeenCalled();
  });

  it('T8: score 2 (small range) ignores overrides and returns small profile', () => {
    configGet.mockImplementation((key) => {
      if (key === 'opensandbox.defaultCpuLimit') return '2';
      if (key === 'opensandbox.defaultMemoryLimit') return '1Gi';
      return null;
    });
    expect(service.getProfile(2)).toEqual({ cpuLimit: '0.5', memoryLimit: '256Mi' });
    expect(configGet).not.toHaveBeenCalled();
  });

  it('T9: NaN score returns small profile without calling configGet', () => {
    expect(service.getProfile(NaN)).toEqual({ cpuLimit: '0.5', memoryLimit: '256Mi' });
    expect(configGet).not.toHaveBeenCalled();
  });

  it('T10: negative score returns small profile without calling configGet', () => {
    expect(service.getProfile(-1)).toEqual({ cpuLimit: '0.5', memoryLimit: '256Mi' });
    expect(configGet).not.toHaveBeenCalled();
  });
});
