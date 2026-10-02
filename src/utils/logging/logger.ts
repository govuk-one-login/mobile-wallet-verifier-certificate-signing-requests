import { Logger } from '@aws-lambda-powertools/logger';
import type { Context } from 'aws-lambda';

export const logger = new Logger();

export const setupLogger = (context: Context) => {
  logger.resetKeys();
  logger.addContext(context);
  logger.appendKeys({
    functionVersion: context.functionVersion,
  });
};

export type S3SourceLogProperties = {
  sourceBucket: string;
  sourceKey: string;
  sourceVersionId: string | undefined;
};

const S3_SOURCE_LOG_KEYS = [
  'sourceBucket',
  'sourceKey',
  'sourceVersionId',
] as const;

/**
 * Removes the S3 source of a previously processed object, so nothing logged
 * about the next object is attributed to it.
 */
export const removeS3SourceFromLogger = (): void => {
  logger.removeKeys([...S3_SOURCE_LOG_KEYS]);
};

/** Tags subsequent log entries with the S3 object being processed. */
export const appendS3SourceToLogger = (source: S3SourceLogProperties): void => {
  logger.appendKeys({
    sourceBucket: source.sourceBucket,
    sourceKey: source.sourceKey,
    sourceVersionId: source.sourceVersionId,
  });
};
