import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import {
  setCaStackName,
  setCsrStackName,
  getCaArn,
  getIssuedCertsBucket,
  getCsrValidatedBucket,
} from '../lib/issue-revoke/config.js';

const cfn = mockClient(CloudFormationClient);

const CA_ARN =
  'arn:aws:acm-pca:eu-west-2:123456789012:certificate-authority/abc';
const ISSUED_BUCKET = 'org-dvs-ca-issued-certs-build';
const VALIDATED_BUCKET = 'org-verifier-csr-validated-build';

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
  cfn
    .on(DescribeStacksCommand, { StackName: 'verifier-csr' })
    .resolves({
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
          ],
        },
      ],
    });
}

beforeEach(() => {
  cfn.reset();
  setCaStackName('dvs-ca');
  setCsrStackName('verifier-csr');
});

// ── getCaArn ────────────────────────────────────────────────────────

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

    await expect(getCaArn()).rejects.toThrow(
      /DVSIntermediateCAArn.*not found/,
    );
  });
});

// ── getIssuedCertsBucket ────────────────────────────────────────────

describe('getIssuedCertsBucket', () => {
  it('returns IssuedCertsBucketName from the CA stack', async () => {
    stubCaStack();
    await expect(getIssuedCertsBucket()).resolves.toBe(
      ISSUED_BUCKET,
    );
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

// ── getCsrValidatedBucket ───────────────────────────────────────────

describe('getCsrValidatedBucket', () => {
  it('returns CsrValidatedBucketName from the CSR stack', async () => {
    stubCsrStack();
    await expect(getCsrValidatedBucket()).resolves.toBe(
      VALIDATED_BUCKET,
    );
  });

  it('throws when the output key is absent', async () => {
    cfn
      .on(DescribeStacksCommand, { StackName: 'verifier-csr' })
      .resolves({
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
