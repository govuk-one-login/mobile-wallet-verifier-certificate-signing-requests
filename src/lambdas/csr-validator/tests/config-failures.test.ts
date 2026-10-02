import type { Context } from 'aws-lambda';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { handlerConstructor } from '../handler.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import {
  buildLambdaContext,
  buildS3Event,
  buildValidHandlerDependencies,
  ConsoleSpies,
  spyOnConsole,
  toBytes,
} from './utils/builders.ts';
import '../../../utils/test/matchers.ts';

describe('Handler - Config failures', () => {
  let context: Context;
  let consoleSpies: ConsoleSpies;
  let dependencies: CsrValidatorDependencies;
  let lambdaError: Error | undefined;

  beforeEach(() => {
    consoleSpies = spyOnConsole();
    context = buildLambdaContext();
    dependencies = buildValidHandlerDependencies(toBytes('unused'));
    lambdaError = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each([
    { scenario: 'missing', env: {} },
    { scenario: 'empty', env: { CSR_VALIDATED_BUCKET: '' } },
  ])('Given CSR_VALIDATED_BUCKET is $scenario', ({ env }) => {
    beforeEach(async () => {
      dependencies.env = env;
      try {
        await handlerConstructor(dependencies, buildS3Event(), context);
      } catch (error: unknown) {
        lambdaError = error as Error;
      }
    });

    it('logs INVALID_CONFIG', () => {
      expect(consoleSpies.error).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_INVALID_CONFIG',
        data: {
          missingEnvironmentVariables: ['CSR_VALIDATED_BUCKET'],
        },
      });
    });

    it('throws an error', () => {
      expect(lambdaError).toBeDefined();
      expect(lambdaError!.message).toBe(
        'Config validation failed: missing CSR_VALIDATED_BUCKET',
      );
    });

    it('reads and writes nothing', () => {
      expect(dependencies.getS3Object).not.toHaveBeenCalled();
      expect(dependencies.putS3Object).not.toHaveBeenCalled();
    });
  });
});
