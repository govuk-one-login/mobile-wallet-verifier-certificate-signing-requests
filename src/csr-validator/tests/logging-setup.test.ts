import type { Context } from 'aws-lambda';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { handlerConstructor } from '../handler.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import { logger } from '../../utils/logging/logger.ts';
import { buildCsr } from '../../utils/csr-validation/tests/utils/builders.ts';
import {
  buildLambdaContext,
  buildS3Event,
  buildValidHandlerDependencies,
  ConsoleSpies,
  SOURCE_BUCKET,
  spyOnConsole,
  toBytes,
  VERSION_ID,
} from './utils/builders.ts';
import '../../utils/test/matchers.ts';

describe('Handler - per invocation logging setup', () => {
  let context: Context;
  let consoleSpies: ConsoleSpies;
  let dependencies: CsrValidatorDependencies;

  beforeEach(async () => {
    consoleSpies = spyOnConsole();
    context = buildLambdaContext();
    dependencies = buildValidHandlerDependencies(toBytes(await buildCsr()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('On every invocation', () => {
    beforeEach(async () => {
      logger.appendKeys({ testKey: 'testValue' });
      await handlerConstructor(dependencies, buildS3Event(), context);
    });

    it('logs STARTED message with context and function details', () => {
      expect(consoleSpies.info).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_STARTED',
        functionVersion: '1',
        function_arn:
          'arn:aws:lambda:eu-west-2:123456789012:function:mockFunctionName',
      });
    });

    it('adds the S3 source to entries logged while processing a record', () => {
      expect(consoleSpies.info).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_COMPLETED',
        functionVersion: '1',
        sourceBucket: SOURCE_BUCKET,
        sourceKey: 'incoming/org.pem',
        sourceVersionId: VERSION_ID,
      });
    });

    it('clears pre-existing log attributes', () => {
      expect(consoleSpies.info).not.toHaveBeenCalledWithLogFields({
        testKey: 'testValue',
      });
    });
  });

  describe('Given a previous invocation appended an S3 source', () => {
    beforeEach(async () => {
      await handlerConstructor(dependencies, buildS3Event(), context);
      consoleSpies.info.mockClear();
      await handlerConstructor(dependencies, buildS3Event(), context);
    });

    it('does not carry the source keys into the next STARTED entry', () => {
      expect(consoleSpies.info).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_STARTED',
      });
      expect(consoleSpies.info).not.toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_STARTED',
        sourceKey: 'incoming/org.pem',
      });
    });
  });
});
