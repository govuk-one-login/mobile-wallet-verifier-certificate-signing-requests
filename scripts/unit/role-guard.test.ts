import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { assertRole } from '../lib/issue-revoke/role-guard.js';

const sts = mockClient(STSClient);

beforeEach(() => {
  sts.reset();
});

describe('assertRole', () => {
  it('returns ARN for ApprovedMobWalletCAIssueRevoke role', async () => {
    const arn =
      'arn:aws:sts::123456789012:assumed-role/' +
      'AWSReservedSSO_ApprovedMobWalletCAIssueRevoke_abc123/user';
    sts.on(GetCallerIdentityCommand).resolves({ Arn: arn });

    await expect(assertRole()).resolves.toBe(arn);
  });

  it('returns ARN for AdministratorAccessPermission role', async () => {
    const arn =
      'arn:aws:sts::123456789012:assumed-role/' +
      'AWSReservedSSO_AdministratorAccessPermission_xyz789/user';
    sts.on(GetCallerIdentityCommand).resolves({ Arn: arn });

    await expect(assertRole()).resolves.toBe(arn);
  });

  it('rejects an unauthorised role', async () => {
    const arn =
      'arn:aws:sts::123456789012:assumed-role/' +
      'AWSReservedSSO_ReadOnlyAccess_abc/user';
    sts.on(GetCallerIdentityCommand).resolves({ Arn: arn });

    await expect(assertRole()).rejects.toThrow(/Access denied/);
  });

  it('rejects when ARN is undefined', async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Arn: undefined });

    await expect(assertRole()).rejects.toThrow(/Access denied/);
  });

  it('rejects when STS call fails', async () => {
    sts.on(GetCallerIdentityCommand).rejects(new Error('ExpiredToken'));

    await expect(assertRole()).rejects.toThrow('ExpiredToken');
  });
});
