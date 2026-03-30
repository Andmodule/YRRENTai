import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FileStoragePort {
  put(key: string, data: Buffer, mimeType: string): Promise<string>;
  getUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

@Injectable()
export class FileService implements FileStoragePort {
  private readonly logger = new Logger(FileService.name);

  constructor(private readonly configService: ConfigService) {}

  async put(key: string, _data: Buffer, _mimeType: string): Promise<string> {
    this.logger.log(`Storing file: ${key}`);
    return key;
  }

  async getUrl(key: string): Promise<string> {
    return `/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    this.logger.log(`Deleting file: ${key}`);
  }

  async exists(_key: string): Promise<boolean> {
    return false;
  }

  async upload() {
    return { data: { message: 'File upload stub' } };
  }
}
