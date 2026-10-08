/**
 * S3 core operations for the issue-revoke script.
 *
 * All reads and writes are in-memory — no files are written to the local
 * filesystem.  This satisfies AC1: CSRs are fetched from the csr-validated
 * bucket into memory and issued certificates are uploaded directly from
 * memory to the output S3 bucket.
 */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  paginateListObjectsV2,
  NoSuchKey,
  NotFound,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AWS_REGION, PRESIGN_EXPIRES_IN } from './constants.js';
import { getOperatorCredentials } from './config.js';

// Client factory

export function createS3Client(): S3Client {
  return new S3Client({
    region: AWS_REGION,
    credentials: getOperatorCredentials(),
  });
}

// Download (in-memory)

/**
 * Downloads an S3 object and returns its content as a UTF-8 string.
 * No data is written to disk.
 */
export async function download(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  try {
    const { Body } = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const text = await Body?.transformToString('utf-8');
    if (!text) {
      throw new Error(`Downloaded empty body from s3://${bucket}/${key}.`);
    }
    return text;
  } catch (err) {
    if (err instanceof NoSuchKey || err instanceof NotFound) {
      (err as Error).message =
        `Object not found: s3://${bucket}/${key}. ` +
        'Has the CSR been validated and placed in the bucket?';
      throw err;
    }
    throw err;
  }
}

// Upload (in-memory)

/**
 * Uploads a string body to S3 as a PEM file.
 * No temporary files are created.
 */
export async function upload(
  s3: S3Client,
  bucket: string,
  key: string,
  body: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/x-pem-file',
    }),
  );
}

// Verify

/**
 * Confirms an object exists in the bucket after upload.
 */
export async function verifyPresent(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    throw new Error(
      `Verification failed: s3://${bucket}/${key} not found after upload.`,
    );
  }
}

// List CSR files

/**
 * Lists all `.pem` object keys in the csr-validated bucket.
 * Uses pagination to handle buckets with many objects.
 */
export async function listCsrFiles(
  s3: S3Client,
  bucket: string,
): Promise<string[]> {
  const keys: string[] = [];

  const paginator = paginateListObjectsV2({ client: s3 }, { Bucket: bucket });

  for await (const page of paginator) {
    for (const obj of page.Contents ?? []) {
      if (obj.Key?.endsWith('.pem')) {
        keys.push(obj.Key);
      }
    }
  }

  return keys.sort((a, b) => a.localeCompare(b));
}

// Pre-signed URLs

/**
 * Generates a pre-signed GET URL valid for {@link PRESIGN_EXPIRES_IN}
 * seconds (5 days).
 */
export async function presignGetUrl(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: PRESIGN_EXPIRES_IN,
  });
}
