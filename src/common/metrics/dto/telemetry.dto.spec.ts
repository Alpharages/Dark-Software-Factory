import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ShortcutTelemetryDto } from './telemetry.dto';

describe('ShortcutTelemetryDto', () => {
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

  it('should fail validation if shortcut is an empty string', async () => {
    const dto = plainToInstance(ShortcutTelemetryDto, { shortcut: '' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('shortcut');
  });
});
