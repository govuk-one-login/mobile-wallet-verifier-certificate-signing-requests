import type { CsrSource } from './parse-s3-record.ts';
import type { ValidationOutcome } from './build-outcome.ts';

export type Notification = {
  subject: string;
  message: string;
};

const SNS_SUBJECT_MAX_LENGTH = 100;

export const buildNotification = (
  source: CsrSource,
  outcome: ValidationOutcome,
): Notification => {
  const { status, sha256 } = outcome.resultRecord;
  const label = status === 'pass' ? 'passed' : 'failed';

  const subject = truncate(
    `CSR validation ${label}: ${source.key}`,
    SNS_SUBJECT_MAX_LENGTH,
  );

  const message = [
    `CSR validation ${label}.`,
    ``,
    `Original: ${source.key}`,
    `SHA-256: ${sha256 ?? 'N/A'}`,
    `Status: ${status}`,
  ].join('\n');

  return { subject, message };
};

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
