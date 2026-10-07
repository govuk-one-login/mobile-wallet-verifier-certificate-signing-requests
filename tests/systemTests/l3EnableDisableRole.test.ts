import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const { STACK_NAME, AWS_ACCOUNT_ID, AWS_REGION = 'eu-west-2' } = process.env;

if (!STACK_NAME) throw new Error('STACK_NAME env var is required');
if (!AWS_ACCOUNT_ID) throw new Error('AWS_ACCOUNT_ID env var is required');

const csrReceivedBucket = `${AWS_ACCOUNT_ID}-${STACK_NAME}-csr-received`;
const csrValidatedBucket = `${AWS_ACCOUNT_ID}-${STACK_NAME}-csr-validated`;
const roleArn = `arn:aws:iam::${AWS_ACCOUNT_ID}:role/${STACK_NAME}-L3EnableDisableOperatorRole`;

const fixtures = {
  [csrReceivedBucket]: ['incoming/test1.csr'],
  [csrValidatedBucket]: ['validated/test1.json', 'failed/test1.json'],
};

// CLI role client — uses ambient credentials from the shell environment
const cliS3 = new S3Client({ region: AWS_REGION });

// L3EnableDisableOperatorS3 assumed-role client — populated in beforeAll
let l3EnableDisableOperatorS3: S3Client;

const assertBucketExists = async (
  bucket: string,
  hint: string,
): Promise<void> => {
  try {
    await cliS3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const name = (error as { name?: string }).name ?? 'Error';
    if (name === 'NotFound' || name === 'NoSuchBucket') {
      throw new Error(
        `S3 bucket "${bucket}" does not exist. ${hint} ` +
          `(authenticated against account ${AWS_ACCOUNT_ID}, region ${AWS_REGION}).`,
      );
    }
    throw new Error(
      `Could not verify S3 bucket "${bucket}" (${name}). ${hint} ` +
        `Check your AWS credentials and that you are in the right account/region.`,
    );
  }
};

beforeAll(async () => {
  await assertBucketExists(
    csrReceivedBucket,
    `Expected the ${STACK_NAME} CSR stack to be deployed in this account.`,
  );
  await assertBucketExists(
    csrValidatedBucket,
    `Expected the ${STACK_NAME} CSR stack to be deployed in this account.`,
  );

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
      new PutObjectCommand({
        Bucket: csrValidatedBucket,
        Key: key,
        Body: 'test-fixture',
      }),
    );
  }
});

afterAll(async () => {
  // Best-effort cleanup: never let a teardown failure
  for (const [bucket, keys] of Object.entries(fixtures)) {
    for (const key of keys) {
      try {
        await cliS3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        // Best-effort cleanup: ignore teardown failures
      }
    }
  }
});

describe('L3EnableDisableOperator role S3 permissions', () => {
  it('allows s3:PutObject on csr-received/incoming/*', async () => {
    await expect(
      l3EnableDisableOperatorS3.send(
        new PutObjectCommand({
          Bucket: csrReceivedBucket,
          Key: 'incoming/test1.csr',
          Body: 'test',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('denies s3:PutObject on csr-validated', async () => {
    await expect(
      l3EnableDisableOperatorS3.send(
        new PutObjectCommand({
          Bucket: csrValidatedBucket,
          Key: 'validated/test1.json',
          Body: 'test',
        }),
      ),
    ).rejects.toThrow(/not authorized/);
  });

  it('allows s3:ListBucket on csr-received', async () => {
    await expect(
      l3EnableDisableOperatorS3.send(
        new ListObjectsV2Command({ Bucket: csrReceivedBucket }),
      ),
    ).resolves.toBeDefined();
  });

  it('allows s3:ListBucket on csr-validated', async () => {
    await expect(
      l3EnableDisableOperatorS3.send(
        new ListObjectsV2Command({ Bucket: csrValidatedBucket }),
      ),
    ).resolves.toBeDefined();
  });
});
