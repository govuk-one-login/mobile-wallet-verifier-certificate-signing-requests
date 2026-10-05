import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {
  download,
  upload,
  verifyPresent,
  listCsrFiles,
} from '../lib/issue-revoke/s3-core.js';

const s3 = mockClient(S3Client);

const BUCKET = 'test-bucket';
const KEY = 'some/key.pem';

/** Mimics the SDK Body object with transformToString. */
function fakeBody(content: string) {
  return {
    transformToString: async () => content,
  };
}

beforeEach(() => {
  s3.reset();
});

// ── download ────────────────────────────────────────────────────────

describe('download', () => {
  it('returns the UTF-8 body string', async () => {
    s3.on(GetObjectCommand).resolves({
      Body: fakeBody('-----BEGIN CERTIFICATE REQUEST-----\n') as never,
    });

    const result = await download(
      new S3Client({}),
      BUCKET,
      KEY,
    );
    expect(result).toBe(
      '-----BEGIN CERTIFICATE REQUEST-----\n',
    );
  });

  it('throws when body is empty', async () => {
    s3.on(GetObjectCommand).resolves({
      Body: fakeBody('') as never,
    });

    await expect(
      download(new S3Client({}), BUCKET, KEY),
    ).rejects.toThrow(/empty body/i);
  });

  it('throws when body is undefined', async () => {
    s3.on(GetObjectCommand).resolves({
      Body: undefined,
    });

    await expect(
      download(new S3Client({}), BUCKET, KEY),
    ).rejects.toThrow(/empty body/i);
  });

  it('throws a helpful message on NoSuchKey', async () => {
    const err = new Error('NoSuchKey');
    err.name = 'NoSuchKey';
    Object.assign(err, { $metadata: {}, Code: 'NoSuchKey' });
    s3.on(GetObjectCommand).rejects(err);

    await expect(
      download(new S3Client({}), BUCKET, KEY),
    ).rejects.toThrow(/not found|NoSuchKey/i);
  });

  it('re-throws unrecognised errors', async () => {
    s3.on(GetObjectCommand).rejects(
      new Error('AccessDenied'),
    );

    await expect(
      download(new S3Client({}), BUCKET, KEY),
    ).rejects.toThrow('AccessDenied');
  });
});

// ── upload ──────────────────────────────────────────────────────────

describe('upload', () => {
  it('sends PutObjectCommand with correct params', async () => {
    s3.on(PutObjectCommand).resolves({});

    await upload(new S3Client({}), BUCKET, KEY, 'pem-content');

    const calls = s3.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toEqual({
      Bucket: BUCKET,
      Key: KEY,
      Body: 'pem-content',
      ContentType: 'application/x-pem-file',
    });
  });
});

// ── verifyPresent ───────────────────────────────────────────────────

describe('verifyPresent', () => {
  it('resolves when HeadObject succeeds', async () => {
    s3.on(HeadObjectCommand).resolves({});

    await expect(
      verifyPresent(new S3Client({}), BUCKET, KEY),
    ).resolves.toBeUndefined();
  });

  it('throws when HeadObject fails', async () => {
    s3.on(HeadObjectCommand).rejects(new Error('not found'));

    await expect(
      verifyPresent(new S3Client({}), BUCKET, KEY),
    ).rejects.toThrow(/Verification failed/);
  });
});

// ── listCsrFiles ────────────────────────────────────────────────────

describe('listCsrFiles', () => {
  it('returns sorted .pem keys', async () => {
    s3.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'beta.pem' },
        { Key: 'alpha.pem' },
        { Key: 'gamma.pem' },
      ],
    });

    const result = await listCsrFiles(new S3Client({}), BUCKET);
    expect(result).toEqual([
      'alpha.pem',
      'beta.pem',
      'gamma.pem',
    ]);
  });

  it('ignores non-.pem files', async () => {
    s3.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'csr.pem' },
        { Key: 'readme.txt' },
        { Key: 'data.json' },
      ],
    });

    const result = await listCsrFiles(new S3Client({}), BUCKET);
    expect(result).toEqual(['csr.pem']);
  });

  it('returns empty array for empty bucket', async () => {
    s3.on(ListObjectsV2Command).resolves({
      Contents: [],
    });

    const result = await listCsrFiles(new S3Client({}), BUCKET);
    expect(result).toEqual([]);
  });

  it('returns empty array when Contents is undefined', async () => {
    s3.on(ListObjectsV2Command).resolves({});

    const result = await listCsrFiles(new S3Client({}), BUCKET);
    expect(result).toEqual([]);
  });
});
