import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { HelloResponseDto } from '../common/dto';

/**
 * Hello World Controller
 *
 * Provides a simple REST API endpoint that returns a greeting message
 * with the current timestamp.
 */
@ApiTags('Hello')
@Controller('api')
export class HelloController {
  /**
   * Hello World Endpoint
   *
   * Returns a simple greeting message with the current timestamp.
   * This is a public endpoint that does not require authentication.
   *
   * @returns HelloResponseDto containing message and timestamp
   */
  @Public()
  @Get('hello')
  @ApiOperation({
    summary: 'Hello World',
    description: 'Returns a greeting message with the current timestamp',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully returns hello world message',
    type: HelloResponseDto,
  })
  getHello(): HelloResponseDto {
    return {
      message: 'Hello World',
      timestamp: new Date().toISOString(),
    };
  }
}
