import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const { STACK_NAME, AWS_ACCOUNT_ID, AWS_REGION = 'eu-west-2' } = process.env;

if (!STACK_NAME) throw new Error('STACK_NAME env var is required');
if (!AWS_ACCOUNT_ID) throw new Error('AWS_ACCOUNT_ID env var is required');

const csrReceivedBucket = `${AWS_ACCOUNT_ID}-${STACK_NAME}-csr-received`;
const csrValidatedBucket = `${AWS_ACCOUNT_ID}-${STACK_NAME}-csr-validated`;
const roleArn = `arn:aws:iam::${AWS_ACCOUNT_ID}:role/${STACK_NAME}-L3EnableDisableOperatorRole`;

const fixtures = {
  [csrReceivedBucket]: ['incoming/test.csr'],
  [csrValidatedBucket]: ['validated/test.json', 'failed/test.json'],
};

// CLI role client — uses ambient credentials from the shell environment
const cliS3 = new S3Client({ region: AWS_REGION });

// L3EnableDisableOperatorS3 assumed-role client — populated in beforeAll
let l3EnableDisableOperatorS3: S3Client;

beforeAll(async () => {
  // Assume L3EnableDisableOperatorRole
  const sts = new STSClient({ region: AWS_REGION });
  const { Credentials } = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'person1-system-test',
    }),
  );
  l3EnableDisableOperatorS3 = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: Credentials!.AccessKeyId!,
      secretAccessKey: Credentials!.SecretAccessKey!,
      sessionToken: Credentials!.SessionToken,
    },
  });

  // Seed fixture objects into csr-validated using the CLI role
  for (const key of fixtures[csrValidatedBucket]) {
    await cliS3.send(
      new PutObjectCommand({ Bucket: csrValidatedBucket, Key: key, Body: 'test-fixture' }),
    );
  }
});

afterAll(async () => {
  // Clean up all fixture objects using the CLI role
  for (const [bucket, keys] of Object.entries(fixtures)) {
    for (const key of keys) {
      await cliS3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
  }
});

describe('Person1 role S3 permissions', () => {
  it('allows s3:PutObject on csr-received/incoming/*', async () => {
    await expect(
      l3EnableDisableOperatorS3.send(
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
      l3EnableDisableOperatorS3.send(
        new GetObjectCommand({
          Bucket: csrValidatedBucket,
          Key: 'validated/test.json',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('allows s3:GetObject on csr-validated/failed/*.json', async () => {
    await expect(
      l3EnableDisableOperatorS3.send(
        new GetObjectCommand({
          Bucket: csrValidatedBucket,
          Key: 'failed/test.json',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('denies s3:GetObject on csr-received', async () => {
    await expect(
      l3EnableDisableOperatorS3.send(
        new GetObjectCommand({
          Bucket: csrReceivedBucket,
          Key: 'incoming/test.csr',
        }),
      ),
    ).rejects.toThrow(/not authorized/);
  });

  it('denies s3:PutObject on csr-validated', async () => {
    await expect(
      l3EnableDisableOperatorS3.send(
        new PutObjectCommand({
          Bucket: csrValidatedBucket,
          Key: 'validated/test.json',
          Body: 'test',
        }),
      ),
    ).rejects.toThrow(/not authorized/);
  });

  it('allows s3:ListBucket on csr-received', async () => {
    await expect(
      l3EnableDisableOperatorS3.send(
        new ListObjectsV2Command({
          Bucket: csrReceivedBucket,
        }),
      ),
    ).resolves.toBeDefined();
  });
});
