import type { Context } from 'aws-lambda';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { handlerConstructor } from '../handler.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import { sha256Hex } from '../../../utils/csr-validation/fingerprint.ts';
import {
  buildCsr,
  derOf,
} from '../../../utils/csr-validation/tests/utils/builders.ts';
import { emptyFailure } from '../../../utils/result/result.ts';
import {
  buildLambdaContext,
  buildS3Event,
  buildValidHandlerDependencies,
  ConsoleSpies,
  expectNoCsrMaterialLogged,
  logEntriesOf,
  putCallsOf,
  spyOnConsole,
  toBytes,
} from './utils/builders.ts';

describe('Handler - Duplicate uploads and multiple records', () => {
  let context: Context;
  let consoleSpies: ConsoleSpies;
  let dependencies: CsrValidatorDependencies;
  let passingPem: string;
  let passingSha256: string;

  beforeEach(async () => {
    consoleSpies = spyOnConsole();
    context = buildLambdaContext();
    passingPem = await buildCsr();
    passingSha256 = sha256Hex(derOf(passingPem));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Given the same bytes are uploaded twice', () => {
    beforeEach(async () => {
      dependencies = buildValidHandlerDependencies(toBytes(passingPem));
      await handlerConstructor(dependencies, buildS3Event(), context);
      await handlerConstructor(dependencies, buildS3Event(), context);
    });

    it('writes identical keys and bodies both times', () => {
      const calls = putCallsOf(dependencies);

      expect(calls).toHaveLength(4);
      expect(calls.slice(2)).toStrictEqual(calls.slice(0, 2));
      expect(calls.map(({ key }) => key)).toStrictEqual([
        `validated/${passingSha256}.json`,
        `validated/${passingSha256}.pem`,
        `validated/${passingSha256}.json`,
        `validated/${passingSha256}.pem`,
      ]);
    });
  });

  describe('Given the same CSR is uploaded under two different file names', () => {
    beforeEach(async () => {
      dependencies = buildValidHandlerDependencies(toBytes(passingPem));
      const first = buildS3Event({ key: 'incoming/first.pem' });
      const second = buildS3Event({ key: 'incoming/second.pem' });
      await handlerConstructor(dependencies, first, context);
      await handlerConstructor(dependencies, second, context);
    });

    it('writes the same fingerprint-keyed outputs', () => {
      const calls = putCallsOf(dependencies);

      expect(calls).toHaveLength(4);
      expect(calls.slice(2)).toStrictEqual(calls.slice(0, 2));
    });
  });

  describe('Given an event with two records', () => {
    let failingPem: string;
    let failingSha256: string;

    beforeEach(async () => {
      failingPem = await buildCsr({ namedCurve: 'P-384' });
      failingSha256 = sha256Hex(derOf(failingPem));
      dependencies = buildValidHandlerDependencies(
        toBytes(passingPem),
        toBytes(failingPem),
      );
    });

    describe('When both are processed', () => {
      beforeEach(async () => {
        const event = buildS3Event(
          { key: 'incoming/first.pem', versionId: 'firstVersion' },
          { key: 'incoming/second.pem', versionId: 'secondVersion' },
        );
        await handlerConstructor(dependencies, event, context);
      });

      it('gets each object in record order', () => {
        expect(dependencies.getS3Object).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            key: 'incoming/first.pem',
            versionId: 'firstVersion',
          }),
        );
        expect(dependencies.getS3Object).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            key: 'incoming/second.pem',
            versionId: 'secondVersion',
          }),
        );
      });

      it('writes each outcome in record order', () => {
        expect(putCallsOf(dependencies).map(({ key }) => key)).toStrictEqual([
          `validated/${passingSha256}.json`,
          `validated/${passingSha256}.pem`,
          `failed/${failingSha256}.json`,
          `failed/${failingSha256}.pem`,
        ]);
      });

      it('finishes the first record before getting the second', () => {
        const getOrder = vi.mocked(dependencies.getS3Object).mock
          .invocationCallOrder;
        const putOrder = vi.mocked(dependencies.putS3Object).mock
          .invocationCallOrder;

        expect(putOrder[1]).toBeLessThan(getOrder[1]!);
      });

      it('logs one COMPLETED entry per record with its own source', () => {
        const entries = logEntriesOf(
          consoleSpies.info,
          'CSR_VALIDATOR_COMPLETED',
        );

        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({
          outcome: 'pass',
          sourceKey: 'incoming/first.pem',
          sourceVersionId: 'firstVersion',
          sha256: passingSha256,
        });
        expect(entries[1]).toMatchObject({
          outcome: 'fail',
          sourceKey: 'incoming/second.pem',
          sourceVersionId: 'secondVersion',
          sha256: failingSha256,
        });
      });

      it('does not log either PEM', () => {
        expectNoCsrMaterialLogged(consoleSpies, passingPem, failingPem);
      });
    });

    describe('When the second record has no version id', () => {
      beforeEach(async () => {
        const event = buildS3Event(
          { key: 'incoming/first.pem', versionId: 'firstVersion' },
          { key: 'incoming/second.pem', versionId: null },
        );
        await handlerConstructor(dependencies, event, context);
      });

      it('does not carry the first record version id into the second entry', () => {
        const entries = logEntriesOf(
          consoleSpies.info,
          'CSR_VALIDATOR_COMPLETED',
        );

        expect(entries[1]).toMatchObject({ sourceKey: 'incoming/second.pem' });
        expect(entries[1]).not.toHaveProperty('sourceVersionId');
      });
    });

    describe('When the first record cannot be fetched', () => {
      let lambdaError: Error;

      beforeEach(async () => {
        dependencies.getS3Object = vi.fn().mockResolvedValue(emptyFailure());
        const event = buildS3Event(
          { key: 'incoming/first.pem' },
          { key: 'incoming/second.pem' },
        );
        try {
          await handlerConstructor(dependencies, event, context);
        } catch (error: unknown) {
          lambdaError = error as Error;
        }
      });

      it('still attempts the second record, then throws reporting both', () => {
        expect(lambdaError.message).toBe(
          'Failed to process 2 of 2 records: ' +
            'Failed to get CSR object incoming/first.pem; ' +
            'Failed to get CSR object incoming/second.pem',
        );
        expect(dependencies.getS3Object).toHaveBeenCalledTimes(2);
        expect(dependencies.putS3Object).not.toHaveBeenCalled();
      });
    });
  });
});
