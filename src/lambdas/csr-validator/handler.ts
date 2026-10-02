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

  const failures: Error[] = [];
  for (const record of event.Records) {
    try {
      await processRecord(dependencies, configResult.value, record);
    } catch (error: unknown) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failures.push(failure);
      logger.error(LogMessage.CSR_VALIDATOR_RECORD_FAILED, {
        errorMessage: failure.message,
      });
    }
  }

  if (failures.length === 1) {
    const [onlyFailure] = failures;
    throw new Error(onlyFailure.message, { cause: onlyFailure });
  }
  if (failures.length > 1) {
    throw new Error(
      `Failed to process ${failures.length} of ${event.Records.length} records: ` +
        failures.map((failure) => failure.message).join('; '),
      { cause: failures },
    );
  }
};

const processRecord = async (
  dependencies: CsrValidatorDependencies,
  config: CsrValidatorConfig,
  record: S3EventRecord,
): Promise<void> => {
  const source = getSource(record);
  const csrBytes = await fetchCsr(dependencies, source);
  const report = await validateCsrText(
    new TextDecoder('utf-8').decode(csrBytes),
  );
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

export const handler = handlerConstructor.bind(null, runtimeDependencies);
