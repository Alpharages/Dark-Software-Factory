import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RegistrationService } from './registration.service';
import { RegisterUserDto } from '../dto/register-user.dto';
import { RegisterResponseDto } from '../dto/register-response.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('auth')
@ApiTags('Auth - Registration')
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register new user via invite token' })
  @ApiResponse({
    status: 201,
    description: 'User successfully registered',
    type: RegisterResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input or password requirements not met',
  })
  @ApiResponse({
    status: 404,
    description: 'Invite token not found',
  })
  @ApiResponse({
    status: 409,
    description: 'User already exists',
  })
  @ApiResponse({
    status: 410,
    description: 'Invite token expired',
  })
  async register(@Body() dto: RegisterUserDto): Promise<RegisterResponseDto> {
    return this.registrationService.register(dto);
  }
}
