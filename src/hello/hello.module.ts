import { Module } from '@nestjs/common';
import { HelloController } from './hello.controller';

/**
 * Module for Hello World functionality
 */
@Module({
  controllers: [HelloController],
})
export class HelloModule {}
