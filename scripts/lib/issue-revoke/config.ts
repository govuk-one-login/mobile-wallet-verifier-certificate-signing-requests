import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import type { AwsCredentialIdentity } from '@smithy/types';
import {
  AWS_REGION,
  STACK_OUTPUT_CA_ARN,
  STACK_OUTPUT_ISSUED_CERTS_BUCKET,
  STACK_OUTPUT_CSR_VALIDATED_BUCKET,
  STACK_OUTPUT_OPERATOR_ROLE_ARN,
} from './constants.js';

// State

let caStackName: string | undefined;
let csrStackName: string | undefined;
let operatorCredentials: AwsCredentialIdentity | undefined;

export function setCaStackName(name: string): void {
  caStackName = name;
}

export function setCsrStackName(name: string): void {
  csrStackName = name;
}

/**
 * Returns the assumed operator role credentials.
 * Must call `assumeOperatorRole()` first.
 */
export function getOperatorCredentials(): AwsCredentialIdentity {
  if (!operatorCredentials) {
    throw new Error(
      'Operator credentials not set. Call assumeOperatorRole() first.',
    );
  }
  return operatorCredentials;
}

// Stack output resolution

async function getStackOutput(stackName: string, key: string): Promise<string> {
  const cfn = new CloudFormationClient({ region: AWS_REGION });
  const { Stacks } = await cfn.send(
    new DescribeStacksCommand({ StackName: stackName }),
  );
  const output = Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === key);
  if (!output?.OutputValue) {
    throw new Error(`Output "${key}" not found in stack "${stackName}".`);
  }
  return output.OutputValue;
}

// dvs-ca stack outputs

export async function getCaArn(): Promise<string> {
  if (!caStackName) {
    throw new Error('CA stack name not set. Call setCaStackName() first.');
  }
  return getStackOutput(caStackName, STACK_OUTPUT_CA_ARN);
}

export async function getIssuedCertsBucket(): Promise<string> {
  if (!caStackName) {
    throw new Error('CA stack name not set. Call setCaStackName() first.');
  }
  return getStackOutput(caStackName, STACK_OUTPUT_ISSUED_CERTS_BUCKET);
}

// CSR stack outputs

export async function getCsrValidatedBucket(): Promise<string> {
  if (!csrStackName) {
    throw new Error('CSR stack name not set. Call setCsrStackName() first.');
  }
  return getStackOutput(csrStackName, STACK_OUTPUT_CSR_VALIDATED_BUCKET);
}

export async function getOperatorRoleArn(): Promise<string> {
  if (!csrStackName) {
    throw new Error('CSR stack name not set. Call setCsrStackName() first.');
  }
  return getStackOutput(csrStackName, STACK_OUTPUT_OPERATOR_ROLE_ARN);
}

// Role assumption

/**
 * Assumes the L3IssueRevokeOperatorRole and stores the temporary
 * credentials for use by S3 and ACM PCA clients.
 */
export async function assumeOperatorRole(): Promise<void> {
  const roleArn = await getOperatorRoleArn();
  const sts = new STSClient({ region: AWS_REGION });
  const { Credentials } = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'issue-revoke-ca',
      DurationSeconds: 3600,
    }),
  );

  if (
    !Credentials?.AccessKeyId ||
    !Credentials.SecretAccessKey ||
    !Credentials.SessionToken
  ) {
    throw new Error(
      `Failed to assume role ${roleArn}: no credentials returned.`,
    );
  }

  operatorCredentials = {
    accessKeyId: Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretAccessKey,
    sessionToken: Credentials.SessionToken,
  };
}
