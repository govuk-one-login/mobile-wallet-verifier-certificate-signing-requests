import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  emptyFailure,
  emptySuccess,
  Result,
} from '../../../utils/result/result.ts';
import { logger } from '../../../utils/logging/logger.ts';
import { LogMessage } from '../../../utils/logging/log-message.ts';
import { s3Client } from './s3Client.ts';

export type PutS3ObjectInput = {
  bucket: string;
  key: string;
  body: Uint8Array | string;
  contentType: string;
};

export const putS3Object = async (
  input: PutS3ObjectInput,
): Promise<Result<void, void>> => {
  const { bucket, key, body, contentType } = input;
  const data = { bucket, key, contentType };
  try {
    logger.debug(LogMessage.CSR_VALIDATOR_PUT_S3_OBJECT_ATTEMPT, { data });
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (error: unknown) {
    logger.error(LogMessage.CSR_VALIDATOR_PUT_S3_OBJECT_FAILURE, {
      error,
      data,
    });
    return emptyFailure();
  }

  logger.debug(LogMessage.CSR_VALIDATOR_PUT_S3_OBJECT_SUCCESS, { data });
  return emptySuccess();
};
