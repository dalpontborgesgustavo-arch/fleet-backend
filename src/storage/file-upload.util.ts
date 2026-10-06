import { BadRequestException, ParseFilePipeBuilder } from '@nestjs/common';
import { memoryStorage } from 'multer';

export const MAX_FILE_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;

const ALLOWED_FILE_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

export function isAllowedAttachmentMimeType(mimeType?: string | null) {
  if (!mimeType) return false;
  return mimeType.startsWith('image/') || ALLOWED_FILE_MIME_TYPES.has(mimeType);
}

export const fileUploadMulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_FILE_UPLOAD_SIZE_BYTES,
  },
  fileFilter: (
    _req: unknown,
    file: { mimetype?: string },
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!isAllowedAttachmentMimeType(file.mimetype)) {
      cb(
        new BadRequestException(
          'Arquivo nao permitido. Envie imagem, PDF, Word, Excel, PowerPoint, TXT ou CSV.',
        ),
        false,
      );
      return;
    }

    cb(null, true);
  },
};

export function buildFileUploadPipe() {
  return new ParseFilePipeBuilder()
    .addMaxSizeValidator({
      maxSize: MAX_FILE_UPLOAD_SIZE_BYTES,
    })
    .build({
      fileIsRequired: true,
    });
}
