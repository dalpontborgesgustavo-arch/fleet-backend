import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
  private readonly logger = new Logger(S3UploadService.name);
  private client: S3Client | null = null;

  constructor(private readonly configService: ConfigService) {}

  async uploadImage(file: UploadableFile, prefix: string) {
    return this.uploadFile(file, prefix);
  }

  async uploadFile(file: UploadableFile, prefix: string) {
    const key = this.buildObjectKey(file.originalname, prefix);
    const bucket = this.getBucketName();

    if (!bucket) {
      this.assertLocalStorageAllowed();
      const localUploadDir = this.getLocalUploadDir();
      await mkdir(localUploadDir, { recursive: true });
      await writeFile(join(localUploadDir, key), file.buffer);

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
      this.assertLocalStorageAllowed();
      const safeKey = basename(key);
      const filePath = join(this.getLocalUploadDir(), safeKey);

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

  async imageExists(key: string) {
    const bucket = this.getBucketName();
    if (!bucket) {
      this.assertLocalStorageAllowed();
      try {
        return (await stat(join(this.getLocalUploadDir(), basename(key)))).size > 0;
      } catch {
        return false;
      }
    }
    try {
      const result = await this.getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return (result.ContentLength ?? 0) > 0 && result.ContentType?.startsWith('image/') === true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }

  async deleteFile(key?: string | null) {
    if (!key) return;

    const bucket = this.getBucketName();

    if (!bucket) {
      this.assertLocalStorageAllowed();
      const safeKey = basename(key);
      try {
        await unlink(join(this.getLocalUploadDir(), safeKey));
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
    const safePrefix =
      (prefix || 'file')
        .trim()
        .replace(/[\\/]+/g, '-')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'file';

    // Uploads are exposed by /uploads/:key and local storage is intentionally
    // flat. A logical prefix such as "rnc/corrective-actions" must therefore
    // become part of the file name instead of an undeclared subdirectory.
    return `${safePrefix}-${Date.now()}-${randomUUID()}${safeExtension}`;
  }

  private getBucketName() {
    const bucketName = this.configService.get<string>('AWS_BUCKET_NAME');

    return bucketName || null;
  }

  private getLocalUploadDir() {
    return (
      this.configService.get<string>('LOCAL_UPLOAD_DIR') ||
      join(process.cwd(), 'uploads')
    );
  }

  private assertLocalStorageAllowed() {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const allowLocalUploads =
      this.configService.get<string>('ALLOW_LOCAL_UPLOADS') === 'true';

    if (nodeEnv === 'production' && !allowLocalUploads) {
      throw new InternalServerErrorException(
        'Armazenamento de arquivos nao configurado',
      );
    }

    this.logger.warn(
      'AWS_BUCKET_NAME nao configurado. Usando armazenamento local apenas para ambiente de desenvolvimento.',
    );
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
