import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import {
  AWS_REGION,
  STACK_OUTPUT_CA_ARN,
  STACK_OUTPUT_ISSUED_CERTS_BUCKET,
  STACK_OUTPUT_CSR_VALIDATED_BUCKET,
} from './constants.js';

// ── State ───────────────────────────────────────────────────────────

let caStackName: string;
let csrStackName: string;

export function setCaStackName(name: string): void {
  caStackName = name;
}

export function setCsrStackName(name: string): void {
  csrStackName = name;
}

// ── Stack output resolution ─────────────────────────────────────────

async function getStackOutput(
  stackName: string,
  key: string,
): Promise<string> {
  const cfn = new CloudFormationClient({ region: AWS_REGION });
  const { Stacks } = await cfn.send(
    new DescribeStacksCommand({ StackName: stackName }),
  );
  const output = Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === key);
  if (!output?.OutputValue) {
    throw new Error(
      `Output "${key}" not found in stack "${stackName}".`,
    );
  }
  return output.OutputValue;
}

// ── dvs-ca stack outputs ────────────────────────────────────────────

export async function getCaArn(): Promise<string> {
  if (!caStackName) {
    throw new Error(
      'CA stack name not set. Call setCaStackName() first.',
    );
  }
  return getStackOutput(caStackName, STACK_OUTPUT_CA_ARN);
}

export async function getIssuedCertsBucket(): Promise<string> {
  if (!caStackName) {
    throw new Error(
      'CA stack name not set. Call setCaStackName() first.',
    );
  }
  return getStackOutput(caStackName, STACK_OUTPUT_ISSUED_CERTS_BUCKET);
}

// ── CSR stack outputs ───────────────────────────────────────────────

export async function getCsrValidatedBucket(): Promise<string> {
  if (!csrStackName) {
    throw new Error(
      'CSR stack name not set. Call setCsrStackName() first.',
    );
  }
  return getStackOutput(csrStackName, STACK_OUTPUT_CSR_VALIDATED_BUCKET);
}
