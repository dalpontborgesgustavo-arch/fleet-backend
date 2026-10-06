import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, stat, unlink, writeFile } from 'fs/promises';
import { basename, extname, join } from 'path';

type UploadableFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

@Injectable()
export class S3UploadService {
  private client: S3Client | null = null;
  private readonly localUploadDir = join(process.cwd(), 'uploads');

  constructor(private readonly configService: ConfigService) {}

  async uploadImage(file: UploadableFile, prefix: string) {
    return this.uploadFile(file, prefix);
  }

  async uploadFile(file: UploadableFile, prefix: string) {
    const key = this.buildObjectKey(file.originalname, prefix);
    const bucket = this.getBucketName();

    if (!bucket) {
      await mkdir(this.localUploadDir, { recursive: true });
      await writeFile(join(this.localUploadDir, key), file.buffer);

      return {
        key,
        url: `/uploads/${key}`,
      };
    }

    await this.getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return {
      key,
      url: `/uploads/${key}`,
    };
  }

  async getObject(key: string) {
    const bucket = this.getBucketName();

    if (!bucket) {
      const safeKey = basename(key);
      const filePath = join(this.localUploadDir, safeKey);

      try {
        const fileStat = await stat(filePath);

        return {
          Body: createReadStream(filePath),
          ContentLength: fileStat.size,
          ContentType: this.guessContentType(safeKey),
          ETag: undefined,
        };
      } catch {
        throw new NotFoundException('Arquivo nao encontrado');
      }
    }

    try {
      return await this.getClient().send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    } catch (error) {
      const s3Error = error as {
        name?: string;
        Code?: string;
        $metadata?: { httpStatusCode?: number };
      };

      if (
        error instanceof NoSuchKey ||
        s3Error.name === 'NoSuchKey' ||
        s3Error.Code === 'NoSuchKey' ||
        (s3Error.Code === 'AccessDenied' &&
          s3Error.$metadata?.httpStatusCode === 403)
      ) {
        throw new NotFoundException('Arquivo nao encontrado');
      }

      throw error;
    }
  }

  async deleteFile(key?: string | null) {
    if (!key) return;

    const bucket = this.getBucketName();

    if (!bucket) {
      const safeKey = basename(key);
      try {
        await unlink(join(this.localUploadDir, safeKey));
      } catch {
        // The database record is authoritative; missing physical files should not block cleanup.
      }
      return;
    }

    try {
      await this.getClient().send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    } catch {
      // Keep the user flow resilient if the object was already removed or storage is temporarily unavailable.
    }
  }

  private buildObjectKey(originalName: string, prefix: string) {
    const extension = extname(originalName || '').toLowerCase();
    const safeExtension = extension || '.bin';

    return `${prefix}-${Date.now()}-${randomUUID()}${safeExtension}`;
  }

  private getBucketName() {
    const bucketName = this.configService.get<string>('AWS_BUCKET_NAME');

    return bucketName || null;
  }

  private getRegion() {
    const region = this.configService.get<string>('AWS_REGION');

    if (!region) {
      throw new InternalServerErrorException('AWS_REGION nao configurado');
    }

    return region;
  }

  private getClient() {
    if (!this.client) {
      const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
      const secretAccessKey = this.configService.get<string>(
        'AWS_SECRET_ACCESS_KEY',
      );

      this.client = new S3Client({
        region: this.getRegion(),
        credentials:
          accessKeyId && secretAccessKey
            ? {
                accessKeyId,
                secretAccessKey,
              }
            : undefined,
      });
    }

    return this.client;
  }

  private guessContentType(key: string) {
    const extension = extname(key).toLowerCase();

    if (extension === '.jpg' || extension === '.jpeg') {
      return 'image/jpeg';
    }

    if (extension === '.png') {
      return 'image/png';
    }

    if (extension === '.webp') {
      return 'image/webp';
    }

    if (extension === '.pdf') {
      return 'application/pdf';
    }

    return 'application/octet-stream';
  }
}
