export const AWS_REGION = 'eu-west-2';

export const DEFAULT_CA_STACK_NAME = 'dvs-ca';

export const STACK_OUTPUT_CA_ARN = 'DVSIntermediateCAArn';
export const STACK_OUTPUT_ISSUED_CERTS_BUCKET = 'IssuedCertsBucketName';

export const STACK_OUTPUT_CSR_VALIDATED_BUCKET = 'CsrValidatedBucketName';
export const STACK_OUTPUT_OPERATOR_ROLE_ARN = 'L3IssueRevokeOperatorRoleArn';

export const SUBORDINATE_CA_TEMPLATE_ARN =
  'arn:aws:acm-pca:::template/SubordinateCACertificate_PathLen0_APIPassthrough/V1';

export const S3_ISSUED_PREFIX = 'issued';

export const PRESIGN_EXPIRES_IN = 432_000; // 5 days in seconds

export const ENVIRONMENTS = [
  'dev',
  'build',
  'integration',
  'production',
] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const ALLOWED_ROLES = [
  'AWSReservedSSO_ApprovedMobWalletCAIssueRevoke_*',
  'AWSReservedSSO_AdministratorAccessPermission_*',
];

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const COLON_HEX_SERIAL_RE = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2})+$/;
