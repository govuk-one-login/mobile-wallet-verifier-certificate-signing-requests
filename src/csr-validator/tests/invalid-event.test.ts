import type { Context } from 'aws-lambda';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { handlerConstructor } from '../handler.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import {
  buildLambdaContext,
  buildS3Event,
  buildValidHandlerDependencies,
  ConsoleSpies,
  logEntriesOf,
  spyOnConsole,
  toBytes,
} from './utils/builders.ts';
import '../../utils/test/matchers.ts';

describe('Handler - Invalid event', () => {
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

  describe('Given the object key is not valid URL encoding', () => {
    beforeEach(async () => {
      const event = buildS3Event({ key: 'incoming/bad%E0%A4%A.pem' });
      try {
        await handlerConstructor(dependencies, event, context);
      } catch (error: unknown) {
        lambdaError = error as Error;
      }
    });

    it('logs INVALID_EVENT', () => {
      expect(consoleSpies.error).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_INVALID_EVENT',
        errorMessage: 'S3 object key is not valid URL encoding',
      });
    });

    it('throws an error', () => {
      expect(lambdaError).toBeDefined();
      expect(lambdaError!.message).toBe(
        'Event validation failed: S3 object key is not valid URL encoding',
      );
    });

    it('reads and writes nothing', () => {
      expect(dependencies.getS3Object).not.toHaveBeenCalled();
      expect(dependencies.putS3Object).not.toHaveBeenCalled();
    });
  });

  describe('Given a valid record followed by one whose key is not valid URL encoding', () => {
    beforeEach(async () => {
      const event = buildS3Event(
        { key: 'incoming/first.pem', versionId: 'firstVersion' },
        { key: 'incoming/bad%E0%A4%A.pem', versionId: 'secondVersion' },
      );
      try {
        await handlerConstructor(dependencies, event, context);
      } catch (error: unknown) {
        lambdaError = error as Error;
      }
    });

    it('processes the first record before throwing', () => {
      expect(dependencies.getS3Object).toHaveBeenCalledTimes(1);
      expect(dependencies.putS3Object).toHaveBeenCalledTimes(2);
      expect(lambdaError!.message).toBe(
        'Event validation failed: S3 object key is not valid URL encoding',
      );
    });

    it('logs INVALID_EVENT without the first record source', () => {
      const entries = logEntriesOf(
        consoleSpies.error,
        'CSR_VALIDATOR_INVALID_EVENT',
      );

      expect(entries).toHaveLength(1);
      expect(entries[0]).not.toHaveProperty('sourceBucket');
      expect(entries[0]).not.toHaveProperty('sourceKey');
      expect(entries[0]).not.toHaveProperty('sourceVersionId');
    });
  });
});
