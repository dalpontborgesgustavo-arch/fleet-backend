import { BadRequestException, ParseFilePipeBuilder } from '@nestjs/common';
import { memoryStorage } from 'multer';

export const MAX_IMAGE_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export const imageUploadMulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_SIZE_BYTES,
  },
  fileFilter: (
    _req: unknown,
    file: { mimetype?: string },
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!file.mimetype?.startsWith('image/')) {
      cb(new BadRequestException('Apenas imagens sao permitidas'), false);
      return;
    }

    cb(null, true);
  },
};

export function buildImageUploadPipe() {
  return new ParseFilePipeBuilder()
    .addMaxSizeValidator({
      maxSize: MAX_IMAGE_UPLOAD_SIZE_BYTES,
    })
    .addFileTypeValidator({
      fileType: /^image\//,
    })
    .build({
      fileIsRequired: true,
    });
}
