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
  topicArn?: string,
  runbookUrl?: string,
): Notification => {
  const { status, sha256 } = outcome.resultRecord;
  const passed = status === 'pass';
  const label = passed ? 'passed' : 'failed';
  const icon = passed ? ':white_check_mark:' : ':x:';
  const context = describeContext(topicArn);

  const subject = truncate(
    `CSR validation ${label}: ${source.key}`,
    SNS_SUBJECT_MAX_LENGTH,
  );

  const title = `${icon} CSR Validation ${passed ? 'Passed' : 'Failed'}${context}`;
  const originalFilename = stripIncomingPrefix(source.key);
  const sha256Filename = sha256 ? `${sha256}.pem` : 'N/A';

  const descriptionLines = [
    `*Original filename:* \`${originalFilename}\``,
    `*SHA-256 filename:* ${sha256Filename}`,
    `*Status:* ${status}`,
  ];
  if (runbookUrl !== undefined && runbookUrl !== '') {
    descriptionLines.push(`*Runbook:* ${runbookUrl}`);
  }
  const description = descriptionLines.join('\n');

  const message = JSON.stringify({
    version: '1.0',
    source: 'custom',
    content: {
      textType: 'client-markdown',
      title,
      description,
    },
  });

  return { subject, message };
};

const describeContext = (topicArn?: string): string => {
  if (topicArn === undefined) {
    return '';
  }
  const parts = topicArn.split(':');
  if (parts.length < 6 || parts[3] === '' || parts[4] === '') {
    return '';
  }
  return ` | ${parts[3]} | Account: ${parts[4]}`;
};

const INCOMING_PREFIX = 'incoming/';

const stripIncomingPrefix = (key: string): string =>
  key.startsWith(INCOMING_PREFIX) ? key.slice(INCOMING_PREFIX.length) : key;

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
