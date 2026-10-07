import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  emptyFailure,
  emptySuccess,
  Result,
  successResult,
} from '../../utils/result/result.ts';
import { logger } from '../../utils/logging/logger.ts';
import { LogMessage } from '../../utils/logging/log-message.ts';

export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  maxAttempts: 3,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 5000,
    throwOnRequestTimeout: true,
  }),
});

export type GetS3ObjectInput = {
  bucket: string;
  key: string;
  versionId?: string;
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
