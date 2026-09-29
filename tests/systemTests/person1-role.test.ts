import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { describe, it, expect, beforeAll } from 'vitest';

const { STACK_NAME, AWS_ACCOUNT_ID, AWS_REGION = 'eu-west-2' } = process.env;

if (!STACK_NAME) throw new Error('STACK_NAME env var is required');
if (!AWS_ACCOUNT_ID) throw new Error('AWS_ACCOUNT_ID env var is required');

const csrReceivedBucket = `${AWS_ACCOUNT_ID}-${STACK_NAME}-csr-received`;
const csrValidatedBucket = `${AWS_ACCOUNT_ID}-${STACK_NAME}-csr-validated`;
const roleArn = `arn:aws:iam::${AWS_ACCOUNT_ID}:role/${STACK_NAME}-Person1Role`;

let s3: S3Client;

beforeAll(async () => {
  const sts = new STSClient({ region: AWS_REGION });
  const { Credentials } = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'person1-system-test',
    }),
  );

  s3 = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: Credentials!.AccessKeyId!,
      secretAccessKey: Credentials!.SecretAccessKey!,
      sessionToken: Credentials!.SessionToken,
    },
  });
});

describe('Person1 role S3 permissions', () => {
  it('allows s3:PutObject on csr-received/incoming/*', async () => {
    await expect(
      s3.send(
        new PutObjectCommand({
          Bucket: csrReceivedBucket,
          Key: 'incoming/test.csr',
          Body: 'test',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('allows s3:GetObject on csr-validated/validated/*.json', async () => {
    await expect(
      s3.send(
        new GetObjectCommand({
          Bucket: csrValidatedBucket,
          Key: 'validated/test.json',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('allows s3:GetObject on csr-validated/failed/*.json', async () => {
    await expect(
      s3.send(
        new GetObjectCommand({
          Bucket: csrValidatedBucket,
          Key: 'failed/test.json',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('denies s3:GetObject on csr-received (read access denied)', async () => {
    await expect(
      s3.send(
        new GetObjectCommand({
          Bucket: csrReceivedBucket,
          Key: 'incoming/test.csr',
        }),
      ),
    ).rejects.toThrow(/AccessDenied|403/);
  });

  it('denies s3:ListBucket on csr-received', async () => {
    await expect(
      s3.send(
        new ListObjectsV2Command({
          Bucket: csrReceivedBucket,
        }),
      ),
    ).rejects.toThrow(/AccessDenied|403/);
  });
});
