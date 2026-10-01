import 'reflect-metadata';
import type { Context, S3Event, S3EventRecord } from 'aws-lambda';
import {
  appendS3SourceToLogger,
  logger,
  removeS3SourceFromLogger,
  setupLogger,
} from '../../utils/logging/logger.ts';
import { LogMessage } from '../../utils/logging/log-message.ts';
import { validateCsrText } from '../../utils/csr-validation/validate-csr.ts';
import {
  CsrValidatorDependencies,
  runtimeDependencies,
} from './handler-dependencies.ts';
import { CsrValidatorConfig, getCsrValidatorConfig } from './helpers/config.ts';
import { CsrSource, parseS3Record } from './helpers/parse-s3-record.ts';
import { buildOutcome } from './helpers/build-outcome.ts';
import { writeOutcome } from './helpers/write-outcome.ts';

export const handlerConstructor = async (
  dependencies: CsrValidatorDependencies,
  event: S3Event,
  context: Context,
): Promise<void> => {
  setupLogger(context);
  logger.info(LogMessage.CSR_VALIDATOR_STARTED);

  const configResult = getCsrValidatorConfig(dependencies.env);
  if (configResult.isError) {
    throw new Error(
      `Config validation failed: missing ${configResult.value.missingEnvVars.join(', ')}`,
    );
  }

  for (const record of event.Records) {
    await processRecord(dependencies, configResult.value, record);
  }
};

const processRecord = async (
  dependencies: CsrValidatorDependencies,
  config: CsrValidatorConfig,
  record: S3EventRecord,
): Promise<void> => {
  const source = getSource(record);
  const csrBytes = await fetchCsr(dependencies, source);
  const report = await validateCsrText(decodeUtf8(csrBytes));
  const outcome = buildOutcome(source, report);

  const writeResult = await writeOutcome(dependencies.putS3Object, {
    bucket: config.CSR_VALIDATED_BUCKET,
    outcome,
    csrBytes,
  });
  if (writeResult.isError) {
    throw new Error(`Failed to write ${writeResult.value} for ${source.key}`);
  }

  logger.info(LogMessage.CSR_VALIDATOR_COMPLETED, outcome.logFields);
};

const getSource = (record: S3EventRecord): CsrSource => {
  removeS3SourceFromLogger();
  const sourceResult = parseS3Record(record);
  if (sourceResult.isError) {
    throw new Error(`Event validation failed: ${sourceResult.value}`);
  }
  const source = sourceResult.value;
  appendS3SourceToLogger({
    sourceBucket: source.bucket,
    sourceKey: source.key,
    sourceVersionId: source.versionId,
  });
  return source;
};

const fetchCsr = async (
  dependencies: CsrValidatorDependencies,
  source: CsrSource,
): Promise<Uint8Array> => {
  const getResult = await dependencies.getS3Object({
    bucket: source.bucket,
    key: source.key,
    versionId: source.versionId,
  });
  if (getResult.isError) {
    throw new Error(`Failed to get CSR object ${source.key}`);
  }
  return getResult.value;
};

const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

export const handler = handlerConstructor.bind(null, runtimeDependencies);
