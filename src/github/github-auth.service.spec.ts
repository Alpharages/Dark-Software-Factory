import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GitHubAuthService } from './github-auth.service';
import { GitHubAuthError } from './exceptions/github.exceptions';

describe('GitHubAuthService', () => {
  let service: GitHubAuthService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubAuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GitHubAuthService>(GitHubAuthService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAuthenticatedClient', () => {
    it('should return authenticated client when token is present', async () => {
      jest.spyOn(configService, 'get').mockReturnValue('ghp_token123');

      const client = await service.getAuthenticatedClient();
      expect(client).toBeDefined();
    });

    it('should throw GitHubAuthError when token is missing', async () => {
      jest.spyOn(configService, 'get').mockReturnValue(null);

      await expect(service.getAuthenticatedClient()).rejects.toThrow(GitHubAuthError);
    });
  });
});
