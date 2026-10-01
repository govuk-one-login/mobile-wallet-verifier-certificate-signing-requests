import type { Context } from 'aws-lambda';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { handlerConstructor } from '../handler.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import { RULE_DEFINITIONS } from '../../../utils/csr-validation/validate-csr.ts';
import { buildCsr } from '../../../utils/csr-validation/tests/utils/builders.ts';
import {
  buildLambdaContext,
  buildS3Event,
  buildValidHandlerDependencies,
  ConsoleSpies,
  expectNoCsrMaterialLogged,
  logEntriesOf,
  logOutputOf,
  putCallsOf,
  SOURCE_BUCKET,
  spyOnConsole,
  toBytes,
  VALIDATED_BUCKET,
  VERSION_ID,
} from './utils/builders.ts';

describe('Handler - Non-PEM uploads', () => {
  let context: Context;
  let consoleSpies: ConsoleSpies;
  let dependencies: CsrValidatorDependencies;
  let validPem: string;

  beforeEach(async () => {
    consoleSpies = spyOnConsole();
    context = buildLambdaContext();
    validPem = await buildCsr();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each([
    {
      scenario: 'junk text',
      content: () => toBytes('hello, this is not a CSR\n'),
      uploadedText: 'hello, this is not a CSR',
    },
    {
      scenario: 'bytes that are not valid UTF-8',
      content: () => new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x80]),
    },
    {
      scenario: 'an empty file',
      content: () => new Uint8Array(),
    },
    {
      scenario: 'two PEM blocks',
      content: () => toBytes(validPem + validPem),
    },
    {
      scenario: 'a valid PEM corrupted by a non-UTF-8 byte',
      content: () => {
        const bytes = toBytes(validPem);
        bytes[40] = 0xff;
        return bytes;
      },
    },
    {
      scenario: 'a valid CSR prefixed with a non-breaking space',
      content: () => toBytes(`\u00a0${validPem}`),
    },
    {
      scenario: 'a valid CSR prefixed with a UTF-8 byte order mark',
      content: () => new Uint8Array([0xef, 0xbb, 0xbf, ...toBytes(validPem)]),
    },
  ])('Given $scenario at incoming/My File.pem', (scenario) => {
    const { content } = scenario;
    let uploadedBytes: Uint8Array;

    beforeEach(async () => {
      uploadedBytes = content();
      dependencies = buildValidHandlerDependencies(uploadedBytes);
      const event = buildS3Event({ key: 'incoming/My+File.pem' });
      await handlerConstructor(dependencies, event, context);
    });

    it('gets the object using the URL-decoded key', () => {
      expect(dependencies.getS3Object).toHaveBeenCalledExactlyOnceWith({
        bucket: SOURCE_BUCKET,
        key: 'incoming/My File.pem',
        versionId: VERSION_ID,
      });
    });

    it('writes the uploaded bytes unchanged to failed/My File.pem first', () => {
      expect(dependencies.putS3Object).toHaveBeenNthCalledWith(1, {
        bucket: VALIDATED_BUCKET,
        key: 'failed/My File.pem',
        body: uploadedBytes,
        contentType: 'application/x-pem-file',
      });
      expect(putCallsOf(dependencies)[0]!.body).toBe(uploadedBytes);
    });

    it('then writes a filename-keyed fail record with one FORMAT.PEM violation', () => {
      const [, recordCall] = putCallsOf(dependencies);

      expect(putCallsOf(dependencies)).toHaveLength(2);
      expect(recordCall!.key).toBe('failed/My File.json');
      expect(JSON.parse(recordCall!.body as string)).toStrictEqual({
        status: 'fail',
        sha256: null,
        subjectDn: null,
        violations: [{ rule: 'FORMAT.PEM', message: expect.any(String) }],
      });
    });

    it('logs COMPLETED with outcome fail, keyed by the file name', () => {
      const [entry] = logEntriesOf(
        consoleSpies.info,
        'CSR_VALIDATOR_COMPLETED',
      );

      expect(entry).toMatchObject({
        outcome: 'fail',
        sourceKey: 'incoming/My File.pem',
        sourceVersionId: VERSION_ID,
        resultKey: 'failed/My File.json',
        violations: [{ rule: 'FORMAT.PEM' }],
      });
      expect(entry).not.toHaveProperty('sha256');
      expect(entry).not.toHaveProperty('subjectDn');
    });

    it('logs FORMAT.PEM as failed and every later check as skipped', () => {
      const [entry] = logEntriesOf(
        consoleSpies.info,
        'CSR_VALIDATOR_COMPLETED',
      );
      const checks = entry!.checks as { rule: string; status: string }[];

      expect(checks.map(({ rule }) => rule)).toStrictEqual(
        RULE_DEFINITIONS.map(({ rule }) => rule),
      );
      expect(checks[0]).toMatchObject({
        rule: 'FORMAT.PEM',
        status: 'failed',
        message: expect.any(String),
      });
      for (const check of checks.slice(1)) {
        expect(check.status).toBe('skipped');
      }
    });

    it('does not log the uploaded content', () => {
      expectNoCsrMaterialLogged(consoleSpies, validPem);
      if ('uploadedText' in scenario) {
        expect(logOutputOf(consoleSpies)).not.toContain(scenario.uploadedText);
      }
    });
  });

  describe('Given junk in a sub-folder at incoming/org-a/request.pem', () => {
    beforeEach(async () => {
      dependencies = buildValidHandlerDependencies(toBytes('junk'));
      const event = buildS3Event({ key: 'incoming/org-a/request.pem' });
      await handlerConstructor(dependencies, event, context);
    });

    it('keys the outputs by the base name only', () => {
      expect(putCallsOf(dependencies).map(({ key }) => key)).toStrictEqual([
        'failed/request.pem',
        'failed/request.json',
      ]);
    });
  });

  describe('Given a percent-encoded key with a multi-byte character', () => {
    beforeEach(async () => {
      dependencies = buildValidHandlerDependencies(toBytes('junk'));
      const event = buildS3Event({ key: 'incoming/caf%C3%A9+%2B+co.v2.pem' });
      await handlerConstructor(dependencies, event, context);
    });

    it('decodes the key and keys the outputs by the base name', () => {
      expect(dependencies.getS3Object).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'incoming/café + co.v2.pem' }),
      );
      expect(putCallsOf(dependencies).map(({ key }) => key)).toStrictEqual([
        'failed/café + co.v2.pem',
        'failed/café + co.v2.json',
      ]);
    });
  });
});
