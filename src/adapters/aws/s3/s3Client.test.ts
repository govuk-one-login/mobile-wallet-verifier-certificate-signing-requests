import { describe, expect, it } from 'vitest';
import { s3Client } from './s3Client.ts';

describe('S3 client', () => {
  it('makes at most 3 attempts per request', async () => {
    expect(await s3Client.config.maxAttempts()).toBe(3);
  });

  it('fails a connection or request that takes longer than 5 seconds', async () => {
    const requestHandler = s3Client.config.requestHandler as unknown as {
      configProvider: Promise<Record<string, unknown>>;
    };

    expect(await requestHandler.configProvider).toMatchObject({
      connectionTimeout: 5000,
      requestTimeout: 5000,
      throwOnRequestTimeout: true,
    });
  });
});
