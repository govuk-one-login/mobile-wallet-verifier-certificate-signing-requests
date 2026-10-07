import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const {
  STACK_NAME,
  AWS_ACCOUNT_ID,
  AWS_REGION = 'eu-west-2',
  ISSUED_CERTS_BUCKET_NAME,
} = process.env;

if (!STACK_NAME) throw new Error('STACK_NAME env var is required');
if (!AWS_ACCOUNT_ID) throw new Error('AWS_ACCOUNT_ID env var is required');
if (!ISSUED_CERTS_BUCKET_NAME)
  throw new Error('ISSUED_CERTS_BUCKET_NAME env var is required');

const csrReceivedBucket = `${AWS_ACCOUNT_ID}-${STACK_NAME}-csr-received`;
const csrValidatedBucket = `${AWS_ACCOUNT_ID}-${STACK_NAME}-csr-validated`;
const issuedCertsBucket = ISSUED_CERTS_BUCKET_NAME;
const roleArn = `arn:aws:iam::${AWS_ACCOUNT_ID}:role/${STACK_NAME}-L3IssueRevokeOperatorRole`;

const fixtures = {
  [csrValidatedBucket]: ['validated/test.json', 'failed/test.json'],
  [issuedCertsBucket]: ['issued/test.pem'],
};

const cliS3 = new S3Client({ region: AWS_REGION });
let l3IssueRevokeOperatorS3: S3Client;

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
    issuedCertsBucket,
    'Pass the resolved bucket name in ISSUED_CERTS_BUCKET_NAME, not the ' +
      'CloudFormation export name. Resolve it with: aws cloudformation ' +
      'list-exports --query "Exports[?Name==\'<DvsStackName>-IssuedCertsBucketName\'].Value" --output text',
  );
  await assertBucketExists(
    csrValidatedBucket,
    `Expected the ${STACK_NAME} CSR stack to be deployed in this account.`,
  );

  const sts = new STSClient({ region: AWS_REGION });
  const { Credentials } = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'l3-issue-revoke-system-test',
    }),
  );
  l3IssueRevokeOperatorS3 = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: Credentials!.AccessKeyId!,
      secretAccessKey: Credentials!.SecretAccessKey!,
      sessionToken: Credentials!.SessionToken,
    },
  });

  for (const [bucket, keys] of Object.entries(fixtures)) {
    for (const key of keys) {
      await cliS3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: 'test-fixture',
        }),
      );
    }
  }
});

afterAll(async () => {
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

describe('L3IssueRevokeOperator role - csr-validated bucket', () => {
  it('denies s3:PutObject on csr-validated', async () => {
    await expect(
      l3IssueRevokeOperatorS3.send(
        new PutObjectCommand({
          Bucket: csrValidatedBucket,
          Key: 'validated/test.json',
          Body: 'test',
        }),
      ),
    ).rejects.toThrow(/not authorized/);
  });
});

describe('L3IssueRevokeOperator role - csr-received bucket', () => {
  it('denies s3:PutObject on csr-received', async () => {
    await expect(
      l3IssueRevokeOperatorS3.send(
        new PutObjectCommand({
          Bucket: csrReceivedBucket,
          Key: 'incoming/test.csr',
          Body: 'test',
        }),
      ),
    ).rejects.toThrow(/not authorized/);
  });
});

describe('L3IssueRevokeOperator role - issued certs bucket', () => {
  it('allows s3:PutObject on issued/*', async () => {
    await expect(
      l3IssueRevokeOperatorS3.send(
        new PutObjectCommand({
          Bucket: issuedCertsBucket,
          Key: 'issued/test.pem',
          Body: 'test',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('allows s3:ListBucket on issued/ prefix', async () => {
    await expect(
      l3IssueRevokeOperatorS3.send(
        new ListObjectsV2Command({
          Bucket: issuedCertsBucket,
          Prefix: 'issued/',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('denies s3:ListBucket on other prefixes', async () => {
    await expect(
      l3IssueRevokeOperatorS3.send(
        new ListObjectsV2Command({
          Bucket: issuedCertsBucket,
          Prefix: 'other/',
        }),
      ),
    ).rejects.toThrow(/not authorized/);
  });
});

describe('L3IssueRevokeOperator role - s3:ListBucket on CSR buckets', () => {
  it('allows s3:ListBucket on csr-received', async () => {
    await expect(
      l3IssueRevokeOperatorS3.send(
        new ListObjectsV2Command({ Bucket: csrReceivedBucket }),
      ),
    ).resolves.toBeDefined();
  });

  it('allows s3:ListBucket on csr-validated', async () => {
    await expect(
      l3IssueRevokeOperatorS3.send(
        new ListObjectsV2Command({ Bucket: csrValidatedBucket }),
      ),
    ).resolves.toBeDefined();
  });
});
