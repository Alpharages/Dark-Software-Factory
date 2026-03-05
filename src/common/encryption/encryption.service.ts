import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY for AES-256-GCM NOT FOUND in environment');
    }

    // Key must be 32 bytes for aes-256-gcm
    this.key = Buffer.from(encryptionKey, 'hex');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY MUST BE a 32-byte hex string (64 characters)');
    }
  }

  /**
   * Encrypts plain text into a string format: iv:authTag:encryptedText
   */
  encrypt(text: string): string {
    const iv = crypto.randomBytes(12); // GCM standard IV length is 12 bytes
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypts a string in format: iv:authTag:encryptedText
   */
  decrypt(hash: string): string {
    const [ivHex, authTagHex, encryptedText] = hash.split(':');

    if (!ivHex || !authTagHex || !encryptedText) {
      throw new Error('Invalid encryption hash format');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
