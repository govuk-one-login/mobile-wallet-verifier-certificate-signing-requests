import type { Context } from 'aws-lambda';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { handlerConstructor } from '../handler.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import { sha256Hex } from '../../../utils/csr-validation/fingerprint.ts';
import { RULE_DEFINITIONS } from '../../../utils/csr-validation/validate-csr.ts';
import {
  buildCsr,
  derOf,
} from '../../../utils/csr-validation/tests/utils/builders.ts';
import {
  buildLambdaContext,
  buildS3Event,
  buildValidHandlerDependencies,
  ConsoleSpies,
  expectNoCsrMaterialLogged,
  logEntriesOf,
  putCallsOf,
  SOURCE_BUCKET,
  spyOnConsole,
  toBytes,
  VALIDATED_BUCKET,
  VERSION_ID,
} from './utils/builders.ts';
import '../../../utils/test/matchers.ts';

describe('Handler - Happy path', () => {
  let context: Context;
  let consoleSpies: ConsoleSpies;
  let dependencies: CsrValidatorDependencies;
  let pem: string;
  let csrBytes: Uint8Array;
  let sha256: string;

  beforeEach(async () => {
    consoleSpies = spyOnConsole();
    context = buildLambdaContext();
    pem = await buildCsr({ subject: 'CN=DVS, O=DVS.COM, C=GB' });
    csrBytes = toBytes(pem);
    sha256 = sha256Hex(derOf(pem));
    dependencies = buildValidHandlerDependencies(csrBytes);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Given a valid CSR is uploaded to incoming/org.pem', () => {
    beforeEach(async () => {
      await handlerConstructor(dependencies, buildS3Event(), context);
    });

    it('gets the exact object version named in the event', () => {
      expect(dependencies.getS3Object).toHaveBeenCalledExactlyOnceWith({
        bucket: SOURCE_BUCKET,
        key: 'incoming/org.pem',
        versionId: VERSION_ID,
      });
    });

    it('writes the uploaded bytes to validated/<sha256>.pem first', () => {
      expect(dependencies.putS3Object).toHaveBeenNthCalledWith(1, {
        bucket: VALIDATED_BUCKET,
        key: `validated/${sha256}.pem`,
        body: csrBytes,
        contentType: 'application/x-pem-file',
      });
      expect(putCallsOf(dependencies)[0]!.body).toBe(csrBytes);
    });

    it('then writes the pass result record to validated/<sha256>.json', () => {
      const [, recordCall] = putCallsOf(dependencies);

      expect(putCallsOf(dependencies)).toHaveLength(2);
      expect(recordCall).toEqual({
        bucket: VALIDATED_BUCKET,
        key: `validated/${sha256}.json`,
        body: expect.any(String),
        contentType: 'application/json',
      });
      expect(JSON.parse(recordCall!.body as string)).toStrictEqual({
        status: 'pass',
        sha256,
        subjectDn: 'CN=DVS,O=DVS.COM,C=GB',
        violations: [],
      });
    });

    it('logs one self-sufficient COMPLETED entry with outcome pass', () => {
      const entries = logEntriesOf(
        consoleSpies.info,
        'CSR_VALIDATOR_COMPLETED',
      );

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        message: 'CSR validation complete',
        outcome: 'pass',
        sourceBucket: SOURCE_BUCKET,
        sourceKey: 'incoming/org.pem',
        sourceVersionId: VERSION_ID,
        sha256,
        resultKey: `validated/${sha256}.json`,
        subjectDn: 'CN=DVS,O=DVS.COM,C=GB',
        violations: [],
      });
    });

    it('logs all 10 checks as passed', () => {
      const [entry] = logEntriesOf(
        consoleSpies.info,
        'CSR_VALIDATOR_COMPLETED',
      );

      expect(entry!.checks).toStrictEqual(
        RULE_DEFINITIONS.map(({ rule, section }) => ({
          rule,
          section,
          status: 'passed',
        })),
      );
      expect(entry!.checks).toHaveLength(10);
    });

    it('does not log the PEM or its base64 body', () => {
      expectNoCsrMaterialLogged(consoleSpies, pem);
    });
  });

  describe('Given the uploaded PEM has CRLF line endings and trailing blank lines', () => {
    let crlfBytes: Uint8Array;

    beforeEach(async () => {
      crlfBytes = toBytes(pem.replaceAll('\n', '\r\n') + '\r\n\r\n');
      dependencies = buildValidHandlerDependencies(crlfBytes);
      await handlerConstructor(dependencies, buildS3Event(), context);
    });

    it('stores the fetched bytes byte-for-byte under the DER fingerprint', () => {
      const [pemCall] = putCallsOf(dependencies);

      expect(pemCall!.key).toBe(`validated/${sha256}.pem`);
      expect(pemCall!.body).toBe(crlfBytes);
      expect(pemCall!.body).toStrictEqual(
        toBytes(pem.replaceAll('\n', '\r\n') + '\r\n\r\n'),
      );
    });
  });

  describe('Given the uploaded PEM is prefixed with a UTF-8 byte order mark', () => {
    let bomBytes: Uint8Array;

    beforeEach(async () => {
      bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...csrBytes]);
      dependencies = buildValidHandlerDependencies(bomBytes);
      await handlerConstructor(dependencies, buildS3Event(), context);
    });

    it('validates the CSR rather than rejecting it as malformed', () => {
      expect(consoleSpies.info).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_COMPLETED',
        outcome: 'pass',
        resultKey: `validated/${sha256}.json`,
      });
    });

    it('stores the fetched bytes byte-for-byte under the DER fingerprint', () => {
      const [pemCall] = putCallsOf(dependencies);

      expect(pemCall!.key).toBe(`validated/${sha256}.pem`);
      expect(pemCall!.body).toBe(bomBytes);
    });
  });

  describe('Given the event record carries no version id', () => {
    beforeEach(async () => {
      const event = buildS3Event({ versionId: null });
      await handlerConstructor(dependencies, event, context);
    });

    it('gets the object without pinning a version', () => {
      expect(dependencies.getS3Object).toHaveBeenCalledExactlyOnceWith({
        bucket: SOURCE_BUCKET,
        key: 'incoming/org.pem',
        versionId: undefined,
      });
    });

    it('still records the pass outcome', () => {
      expect(consoleSpies.info).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_COMPLETED',
        outcome: 'pass',
        resultKey: `validated/${sha256}.json`,
      });
    });
  });
});
