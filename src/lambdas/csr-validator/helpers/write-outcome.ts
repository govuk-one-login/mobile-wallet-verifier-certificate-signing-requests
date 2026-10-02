import {
  emptySuccess,
  errorResult,
  Result,
} from '../../../utils/result/result.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import type { ValidationOutcome } from './build-outcome.ts';

const PEM_CONTENT_TYPE = 'application/x-pem-file';
const JSON_CONTENT_TYPE = 'application/json';

export type WriteOutcomeInput = {
  bucket: string;
  outcome: ValidationOutcome;
  csrBytes: Uint8Array;
};

export const writeOutcome = async (
  putS3Object: CsrValidatorDependencies['putS3Object'],
  input: WriteOutcomeInput,
): Promise<Result<void, string>> => {
  const { bucket, outcome, csrBytes } = input;

  const pemResult = await putS3Object({
    bucket,
    key: outcome.pemKey,
    body: csrBytes,
    contentType: PEM_CONTENT_TYPE,
  });
  if (pemResult.isError) {
    return errorResult(outcome.pemKey);
  }

  const recordResult = await putS3Object({
    bucket,
    key: outcome.resultKey,
    body: JSON.stringify(outcome.resultRecord),
    contentType: JSON_CONTENT_TYPE,
  });
  if (recordResult.isError) {
    return errorResult(outcome.resultKey);
  }

  return emptySuccess();
};
