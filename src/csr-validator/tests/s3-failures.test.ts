import type { Context } from 'aws-lambda';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { handlerConstructor } from '../handler.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import { sha256Hex } from '../../utils/csr-validation/fingerprint.ts';
import {
  buildCsr,
  derOf,
} from '../../utils/csr-validation/tests/utils/builders.ts';
import { emptyFailure, emptySuccess } from '../../utils/result/result.ts';
import {
  buildLambdaContext,
  buildS3Event,
  buildValidHandlerDependencies,
  ConsoleSpies,
  logEntriesOf,
  putCallsOf,
  spyOnConsole,
  toBytes,
} from './utils/builders.ts';

describe('Handler - S3 failures', () => {
  let context: Context;
  let consoleSpies: ConsoleSpies;
  let dependencies: CsrValidatorDependencies;
  let sha256: string;
  let lambdaError: Error | undefined;

  const invoke = async () => {
    lambdaError = undefined;
    try {
      await handlerConstructor(dependencies, buildS3Event(), context);
    } catch (error: unknown) {
      lambdaError = error as Error;
    }
  };

  beforeEach(async () => {
    consoleSpies = spyOnConsole();
    context = buildLambdaContext();
    const pem = await buildCsr();
    sha256 = sha256Hex(derOf(pem));
    dependencies = buildValidHandlerDependencies(toBytes(pem));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Given getS3Object returns a failure', () => {
    beforeEach(async () => {
      dependencies.getS3Object = vi.fn().mockResolvedValue(emptyFailure());
      await invoke();
    });

    it('throws an error naming the source key', () => {
      expect(lambdaError).toBeDefined();
      expect(lambdaError!.message).toBe(
        'Failed to get CSR object incoming/org.pem',
      );
    });

    it('writes nothing', () => {
      expect(dependencies.putS3Object).not.toHaveBeenCalled();
    });

    it('does not log COMPLETED', () => {
      expect(
        logEntriesOf(consoleSpies.info, 'CSR_VALIDATOR_COMPLETED'),
      ).toHaveLength(0);
    });
  });

  describe('Given the .pem put fails', () => {
    beforeEach(async () => {
      dependencies.putS3Object = vi
        .fn()
        .mockResolvedValueOnce(emptySuccess())
        .mockResolvedValueOnce(emptyFailure());
      await invoke();
    });

    it('throws an error naming the key that could not be written', () => {
      expect(lambdaError).toBeDefined();
      expect(lambdaError!.message).toBe(
        `Failed to write validated/${sha256}.pem for incoming/org.pem`,
      );
    });

    it('attempted the .json put before the .pem put', () => {
      expect(putCallsOf(dependencies).map(({ key }) => key)).toStrictEqual([
        `validated/${sha256}.json`,
        `validated/${sha256}.pem`,
      ]);
    });

    it('does not log COMPLETED', () => {
      expect(
        logEntriesOf(consoleSpies.info, 'CSR_VALIDATOR_COMPLETED'),
      ).toHaveLength(0);
    });
  });

  describe('Given the .json put fails', () => {
    beforeEach(async () => {
      dependencies.putS3Object = vi.fn().mockResolvedValue(emptyFailure());
      await invoke();
    });

    it('throws an error naming the key that could not be written', () => {
      expect(lambdaError).toBeDefined();
      expect(lambdaError!.message).toBe(
        `Failed to write validated/${sha256}.json for incoming/org.pem`,
      );
    });

    it('does not attempt the .pem put', () => {
      expect(putCallsOf(dependencies).map(({ key }) => key)).toStrictEqual([
        `validated/${sha256}.json`,
      ]);
    });

    it('does not log COMPLETED', () => {
      expect(
        logEntriesOf(consoleSpies.info, 'CSR_VALIDATOR_COMPLETED'),
      ).toHaveLength(0);
    });
  });
});
