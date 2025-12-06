import { IsString, IsNotEmpty, IsEnum } from 'class-validator';

/**
 * File Change DTO
 * Validated representation of file operations
 * AC#1: AI-Generated Code Collection
 */

export enum FileOperationType {
  CREATE = 'create',
  MODIFY = 'modify',
  DELETE = 'delete',
}

export enum FileEncodingType {
  UTF8 = 'utf-8',
  BASE64 = 'base64',
}

export class FileChangeDto {
  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsEnum(FileOperationType)
  operation!: FileOperationType;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsEnum(FileEncodingType)
  encoding!: FileEncodingType;
}
