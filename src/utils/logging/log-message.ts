import type { LogAttributes } from '@aws-lambda-powertools/logger/types';

export class LogMessage implements LogAttributes {
  private constructor(
    public readonly messageCode: string,
    public readonly message: string,
  ) {}

  [key: string]: string;

  static readonly CSR_VALIDATOR_STARTED = new LogMessage(
    'CSR_VALIDATOR_STARTED',
    'Lambda handler processing has started.',
  );

  static readonly CSR_VALIDATOR_INVALID_CONFIG = new LogMessage(
    'CSR_VALIDATOR_INVALID_CONFIG',
    'One or more required environment variables were missing or invalid.',
  );

  static readonly CSR_VALIDATOR_INVALID_EVENT = new LogMessage(
    'CSR_VALIDATOR_INVALID_EVENT',
    'Incoming S3 event record is malformed.',
  );

  static readonly CSR_VALIDATOR_RECORD_FAILED = new LogMessage(
    'CSR_VALIDATOR_RECORD_FAILED',
    'Processing of an S3 event record failed; remaining records continue.',
  );

  static readonly CSR_VALIDATOR_COMPLETED = new LogMessage(
    'CSR_VALIDATOR_COMPLETED',
    'CSR validation complete',
  );

  static readonly CSR_VALIDATOR_GET_S3_OBJECT_ATTEMPT = new LogMessage(
    'CSR_VALIDATOR_GET_S3_OBJECT_ATTEMPT',
    'Attempting to get object from S3.',
  );

  static readonly CSR_VALIDATOR_GET_S3_OBJECT_FAILURE = new LogMessage(
    'CSR_VALIDATOR_GET_S3_OBJECT_FAILURE',
    'Failed to get object from S3.',
  );

  static readonly CSR_VALIDATOR_GET_S3_OBJECT_SUCCESS = new LogMessage(
    'CSR_VALIDATOR_GET_S3_OBJECT_SUCCESS',
    'Successfully got object from S3.',
  );

  static readonly CSR_VALIDATOR_PUT_S3_OBJECT_ATTEMPT = new LogMessage(
    'CSR_VALIDATOR_PUT_S3_OBJECT_ATTEMPT',
    'Attempting to put object to S3.',
  );

  static readonly CSR_VALIDATOR_PUT_S3_OBJECT_FAILURE = new LogMessage(
    'CSR_VALIDATOR_PUT_S3_OBJECT_FAILURE',
    'Failed to put object to S3.',
  );

  static readonly CSR_VALIDATOR_PUT_S3_OBJECT_SUCCESS = new LogMessage(
    'CSR_VALIDATOR_PUT_S3_OBJECT_SUCCESS',
    'Successfully put object to S3.',
  );

  static readonly CSR_VALIDATOR_NOTIFY_ATTEMPT = new LogMessage(
    'CSR_VALIDATOR_NOTIFY_ATTEMPT',
    'Attempting to send the outcome notification.',
  );

  static readonly CSR_VALIDATOR_NOTIFY_FAILURE = new LogMessage(
    'CSR_VALIDATOR_NOTIFY_FAILURE',
    'Failed to send the outcome notification; validation outcome is unaffected.',
  );

  static readonly CSR_VALIDATOR_NOTIFY_SUCCESS = new LogMessage(
    'CSR_VALIDATOR_NOTIFY_SUCCESS',
    'Successfully sent the outcome notification.',
  );

  static readonly CSR_VALIDATOR_NOTIFY_SKIPPED = new LogMessage(
    'CSR_VALIDATOR_NOTIFY_SKIPPED',
    'Outcome notification skipped; no notification topic is configured.',
  );
}
