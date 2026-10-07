import path from 'node:path';
import type { S3EventRecord } from 'aws-lambda';
import { logger } from '../../utils/logging/logger.ts';
import { LogMessage } from '../../utils/logging/log-message.ts';
import {
  errorResult,
  Result,
  successResult,
} from '../../utils/result/result.ts';

export type CsrSource = {
  bucket: string;
  key: string;
  versionId: string | undefined;
  keyStem: string;
};

export const parseS3Record = (
  record: S3EventRecord,
): Result<CsrSource, string> => {
  const keyResult = decodeEventKey(record.s3.object.key);
  if (keyResult.isError) {
    logger.error(LogMessage.CSR_VALIDATOR_INVALID_EVENT, {
      errorMessage: keyResult.value,
    });
    return keyResult;
  }
  const key = keyResult.value;
  const { dir, name } = path.posix.parse(key);
  const fileName = name || 'unnamed';

  return successResult({
    bucket: record.s3.bucket.name,
    key,
    versionId: record.s3.object.versionId || undefined,
    keyStem: dir ? `${dir}/${fileName}` : fileName,
  });
};

const decodeEventKey = (eventKey: string): Result<string, string> => {
  try {
    return successResult(decodeURIComponent(eventKey.replaceAll('+', ' ')));
  } catch {
    return errorResult('S3 object key is not valid URL encoding');
  }
};
