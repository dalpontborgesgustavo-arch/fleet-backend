import { ForbiddenException } from '@nestjs/common';
import { BucketActivationsService } from './bucket-activations.service';

describe('BucketActivationsService financial profile', () => {
  const service = new BucketActivationsService({} as any);

  it('allows the financial role to read bucket activations', () => {
    expect(() => (service as any).ensureReadAccess('financeiro')).not.toThrow();
  });

  it('keeps unrelated roles blocked', () => {
    expect(() => (service as any).ensureReadAccess('motorista')).toThrow(
      ForbiddenException,
    );
  });
});
