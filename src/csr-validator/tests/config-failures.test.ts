import type { Context } from 'aws-lambda';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { handlerConstructor } from '../handler.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import {
  buildLambdaContext,
  buildS3Event,
  buildValidHandlerDependencies,
  ConsoleSpies,
  SLACK_WEBHOOK_URL,
  spyOnConsole,
  toBytes,
  VALIDATED_BUCKET,
} from './utils/builders.ts';
import '../../utils/test/matchers.ts';

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
    {
      scenario: 'CSR_VALIDATED_BUCKET is missing',
      env: { SLACK_WEBHOOK_URL },
      missing: ['CSR_VALIDATED_BUCKET'],
    },
    {
      scenario: 'CSR_VALIDATED_BUCKET is empty',
      env: { CSR_VALIDATED_BUCKET: '', SLACK_WEBHOOK_URL },
      missing: ['CSR_VALIDATED_BUCKET'],
    },
    {
      scenario: 'SLACK_WEBHOOK_URL is missing',
      env: { CSR_VALIDATED_BUCKET: VALIDATED_BUCKET },
      missing: ['SLACK_WEBHOOK_URL'],
    },
    {
      scenario: 'both required variables are missing',
      env: {},
      missing: ['CSR_VALIDATED_BUCKET', 'SLACK_WEBHOOK_URL'],
    },
  ])('Given $scenario', ({ env, missing }) => {
    beforeEach(async () => {
      dependencies.env = env;
      try {
        await handlerConstructor(dependencies, buildS3Event(), context);
      } catch (error: unknown) {
        lambdaError = error as Error;
      }
    });

    it('logs INVALID_CONFIG with the missing variables', () => {
      expect(consoleSpies.error).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_INVALID_CONFIG',
        data: {
          missingEnvironmentVariables: missing,
        },
      });
    });

    it('throws an error naming the missing variables', () => {
      expect(lambdaError).toBeDefined();
      expect(lambdaError!.message).toBe(
        `Config validation failed: missing ${missing.join(', ')}`,
      );
    });

    it('reads, writes, and notifies nothing', () => {
      expect(dependencies.getS3Object).not.toHaveBeenCalled();
      expect(dependencies.putS3Object).not.toHaveBeenCalled();
      expect(dependencies.postSlackMessage).not.toHaveBeenCalled();
    });
  });
});
