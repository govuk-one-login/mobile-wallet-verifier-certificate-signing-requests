import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  emptyFailure,
  Result,
  successResult,
} from '../../../utils/result/result.ts';
import { logger } from '../../../utils/logging/logger.ts';
import { LogMessage } from '../../../utils/logging/log-message.ts';
import { s3Client } from './s3Client.ts';

export type GetS3ObjectInput = {
  bucket: string;
  key: string;
  versionId?: string | undefined;
};

export const getS3Object = async (
  input: GetS3ObjectInput,
): Promise<Result<Uint8Array, void>> => {
  const { bucket, key, versionId } = input;
  const data = { bucket, key, versionId };
  let bytes: Uint8Array | undefined;
  try {
    logger.debug(LogMessage.CSR_VALIDATOR_GET_S3_OBJECT_ATTEMPT, { data });
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }),
    );
    bytes = await response.Body?.transformToByteArray();
  } catch (error: unknown) {
    logger.error(LogMessage.CSR_VALIDATOR_GET_S3_OBJECT_FAILURE, {
      error,
      data,
    });
    return emptyFailure();
  }

  if (bytes === undefined) {
    logger.error(LogMessage.CSR_VALIDATOR_GET_S3_OBJECT_FAILURE, {
      errorMessage: 'S3 response has no body',
      data,
    });
    return emptyFailure();
  }

  logger.debug(LogMessage.CSR_VALIDATOR_GET_S3_OBJECT_SUCCESS, { data });
  return successResult(bytes);
};
