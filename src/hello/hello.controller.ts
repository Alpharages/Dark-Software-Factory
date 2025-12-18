import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { HelloResponseDto } from '../common/dto/hello-response.dto';

/**
 * Controller for Hello World endpoint
 */
@Controller('api/hello')
@ApiTags('Hello')
export class HelloController {
  /**
   * Returns a Hello World message with current timestamp
   *
   * @returns HelloResponseDto containing message and timestamp
   */
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Hello World endpoint',
    description: 'Returns a simple Hello World message with current timestamp',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully returns Hello World message',
    type: HelloResponseDto,
  })
  getHello(): HelloResponseDto {
    return {
      message: 'Hello World',
      timestamp: new Date().toISOString(),
    };
  }
}
