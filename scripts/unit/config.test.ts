import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  setCaStackName,
  setCsrStackName,
  getCaArn,
  getIssuedCertsBucket,
  getCsrValidatedBucket,
  getOperatorRoleArn,
  assumeOperatorRole,
  getOperatorCredentials,
} from '../lib/issue-revoke/config.js';

const cfn = mockClient(CloudFormationClient);
const sts = mockClient(STSClient);

const CA_ARN =
  'arn:aws:acm-pca:eu-west-2:123456789012:certificate-authority/abc';
const ISSUED_BUCKET = 'org-dvs-ca-issued-certs-build';
const VALIDATED_BUCKET = 'org-verifier-csr-validated-build';
const OPERATOR_ROLE_ARN =
  'arn:aws:iam::123456789012:role/verifier-csr-L3IssueRevokeOperatorRole';

function stubCaStack(): void {
  cfn.on(DescribeStacksCommand, { StackName: 'dvs-ca' }).resolves({
    Stacks: [
      {
        StackName: 'dvs-ca',
        CreationTime: new Date(),
        StackStatus: 'CREATE_COMPLETE',
        Outputs: [
          {
            OutputKey: 'DVSIntermediateCAArn',
            OutputValue: CA_ARN,
          },
          {
            OutputKey: 'IssuedCertsBucketName',
            OutputValue: ISSUED_BUCKET,
          },
        ],
      },
    ],
  });
}

function stubCsrStack(): void {
  cfn.on(DescribeStacksCommand, { StackName: 'verifier-csr' }).resolves({
    Stacks: [
      {
        StackName: 'verifier-csr',
        CreationTime: new Date(),
        StackStatus: 'CREATE_COMPLETE',
        Outputs: [
          {
            OutputKey: 'CsrValidatedBucketName',
            OutputValue: VALIDATED_BUCKET,
          },
          {
            OutputKey: 'L3IssueRevokeOperatorRoleArn',
            OutputValue: OPERATOR_ROLE_ARN,
          },
        ],
      },
    ],
  });
}

beforeEach(() => {
  cfn.reset();
  sts.reset();
  setCaStackName('dvs-ca');
  setCsrStackName('verifier-csr');
});

// getCaArn

describe('getCaArn', () => {
  it('returns DVSIntermediateCAArn from the CA stack', async () => {
    stubCaStack();
    await expect(getCaArn()).resolves.toBe(CA_ARN);
  });

  it('throws when the output key is absent', async () => {
    cfn.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: 'dvs-ca',
          CreationTime: new Date(),
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [],
        },
      ],
    });

    await expect(getCaArn()).rejects.toThrow(/DVSIntermediateCAArn.*not found/);
  });
});

// getIssuedCertsBucket

describe('getIssuedCertsBucket', () => {
  it('returns IssuedCertsBucketName from the CA stack', async () => {
    stubCaStack();
    await expect(getIssuedCertsBucket()).resolves.toBe(ISSUED_BUCKET);
  });

  it('throws when the output key is absent', async () => {
    cfn.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: 'dvs-ca',
          CreationTime: new Date(),
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [
            {
              OutputKey: 'DVSIntermediateCAArn',
              OutputValue: CA_ARN,
            },
          ],
        },
      ],
    });

    await expect(getIssuedCertsBucket()).rejects.toThrow(
      /IssuedCertsBucketName.*not found/,
    );
  });
});

// getCsrValidatedBucket

describe('getCsrValidatedBucket', () => {
  it('returns CsrValidatedBucketName from the CSR stack', async () => {
    stubCsrStack();
    await expect(getCsrValidatedBucket()).resolves.toBe(VALIDATED_BUCKET);
  });

  it('throws when the output key is absent', async () => {
    cfn.on(DescribeStacksCommand, { StackName: 'verifier-csr' }).resolves({
      Stacks: [
        {
          StackName: 'verifier-csr',
          CreationTime: new Date(),
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [],
        },
      ],
    });

    await expect(getCsrValidatedBucket()).rejects.toThrow(
      /CsrValidatedBucketName.*not found/,
    );
  });

  it('uses the CSR stack name, not the CA stack name', async () => {
    stubCsrStack();
    await getCsrValidatedBucket();

    const calls = cfn.commandCalls(DescribeStacksCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.StackName).toBe('verifier-csr');
  });
});

// getOperatorRoleArn

describe('getOperatorRoleArn', () => {
  it('returns the operator role ARN from the CSR stack', async () => {
    stubCsrStack();
    await expect(getOperatorRoleArn()).resolves.toBe(OPERATOR_ROLE_ARN);
  });

  it('throws when the output key is absent', async () => {
    cfn.on(DescribeStacksCommand, { StackName: 'verifier-csr' }).resolves({
      Stacks: [
        {
          StackName: 'verifier-csr',
          CreationTime: new Date(),
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [],
        },
      ],
    });

    await expect(getOperatorRoleArn()).rejects.toThrow(
      /L3IssueRevokeOperatorRoleArn.*not found/,
    );
  });
});

// assumeOperatorRole + getOperatorCredentials

describe('assumeOperatorRole', () => {
  it('assumes the role and stores credentials', async () => {
    stubCsrStack();
    sts.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: 'AKID',
        SecretAccessKey: 'SECRET',
        SessionToken: 'TOKEN',
        Expiration: new Date(),
      },
    });

    await assumeOperatorRole();

    const creds = getOperatorCredentials();
    expect(creds.accessKeyId).toBe('AKID');
    expect(creds.secretAccessKey).toBe('SECRET');
    expect(creds.sessionToken).toBe('TOKEN');
  });

  it('calls AssumeRole with the correct role ARN', async () => {
    stubCsrStack();
    sts.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: 'AKID',
        SecretAccessKey: 'SECRET',
        SessionToken: 'TOKEN',
        Expiration: new Date(),
      },
    });

    await assumeOperatorRole();

    const calls = sts.commandCalls(AssumeRoleCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input.RoleArn).toBe(OPERATOR_ROLE_ARN);
    expect(calls[0]!.args[0].input.RoleSessionName).toBe('issue-revoke-ca');
  });

  it('throws when STS returns no credentials', async () => {
    stubCsrStack();
    sts.on(AssumeRoleCommand).resolves({
      Credentials: undefined,
    });

    await expect(assumeOperatorRole()).rejects.toThrow(
      /no credentials returned/,
    );
  });
});
