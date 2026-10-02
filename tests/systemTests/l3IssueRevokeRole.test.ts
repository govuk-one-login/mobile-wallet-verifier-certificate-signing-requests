import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
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

beforeAll(async () => {
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
      await cliS3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
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
  it('denies s3:PutObject on issued/*', async () => {
    await expect(
      l3IssueRevokeOperatorS3.send(
        new PutObjectCommand({
          Bucket: issuedCertsBucket,
          Key: 'issued/test.pem',
          Body: 'test',
        }),
      ),
    ).rejects.toThrow(/not authorized/);
  });
});
