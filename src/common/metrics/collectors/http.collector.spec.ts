import { Test, TestingModule } from '@nestjs/testing';
import { HttpCollector } from './http.collector';
import { getToken } from '@willsoto/nestjs-prometheus';
import { HTTP_METRICS } from '../metrics.constants';

describe('HttpCollector', () => {
  let collector: HttpCollector;
  let mockHistogram: any;
  let mockCounter: any;

  beforeEach(async () => {
    mockHistogram = { observe: jest.fn() };
    mockCounter = { inc: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HttpCollector,
        {
          provide: getToken(HTTP_METRICS.REQUEST_DURATION),
          useValue: mockHistogram,
        },
        {
          provide: getToken(HTTP_METRICS.REQUEST_TOTAL),
          useValue: mockCounter,
        },
      ],
    }).compile();

    collector = module.get<HttpCollector>(HttpCollector);
  });

  it('should be defined', () => {
    expect(collector).toBeDefined();
  });

  it('should record request and normalize path', () => {
    collector.recordRequest({
      method: 'GET',
      path: '/api/users/123e4567-e89b-12d3-a456-426614174000',
      statusCode: 200,
      duration: 0.5,
    });

    expect(mockHistogram.observe).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/users/:id' }),
      0.5,
    );
    expect(mockCounter.inc).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/users/:id' }),
    );
  });
});
