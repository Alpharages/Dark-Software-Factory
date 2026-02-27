import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { ShortcutTelemetryDto } from './dto/telemetry.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('MetricsController', () => {
  let controller: MetricsController;
  let service: jest.Mocked<MetricsService>;

  beforeEach(async () => {
    const mockMetricsService = {
      incrementKeyboardShortcutUsage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
      ],
    })
      .overridePipe(ValidationPipe)
      .useValue(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
      .compile();

    controller = module.get<MetricsController>(MetricsController);
    service = module.get(MetricsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('recordShortcutUsage', () => {
    it('should record shortcut usage and return success', async () => {
      const dto: ShortcutTelemetryDto = { shortcut: 'cmd+s' };
      const result = await controller.recordShortcutUsage(dto);

      expect(service.incrementKeyboardShortcutUsage).toHaveBeenCalledWith('cmd+s');
      expect(result).toEqual({ success: true });
    });
  });
});

describe('ShortcutTelemetryDto Validation', () => {
  it('should pass validation with a valid shortcut', async () => {
    const dto = plainToInstance(ShortcutTelemetryDto, { shortcut: 'cmd+s' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail validation if shortcut is missing', async () => {
    const dto = plainToInstance(ShortcutTelemetryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('shortcut');
  });

  it('should fail validation if shortcut is not a string', async () => {
    const dto = plainToInstance(ShortcutTelemetryDto, { shortcut: 123 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
