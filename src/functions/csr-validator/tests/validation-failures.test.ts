import type { Context } from 'aws-lambda';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { handlerConstructor } from '../handler.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import { sha256Hex } from '../../../utils/csr-validation/fingerprint.ts';
import {
  buildCsr,
  derOf,
  toPem,
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

type LoggedCheck = { rule: string; status: string; message?: string };
type ResultViolation = { rule: string; message: string };

const ARCHIVED_FIVE_ATTRIBUTE_SUBJECT =
  '2.5.4.5=8b1f9c4e-2d44-4a76-9c1b-2f1a3b4c5d6e, CN=DVS Acme Sub-CA, ' +
  'OU=DVS PKI Operations, O=Acme Ltd, C=GB';

describe('Handler - Validation failures', () => {
  let context: Context;
  let consoleSpies: ConsoleSpies;
  let dependencies: CsrValidatorDependencies;
  let pem: string;
  let csrBytes: Uint8Array;
  let sha256: string;

  const invokeWith = async (csrPem: string) => {
    pem = csrPem;
    csrBytes = toBytes(pem);
    sha256 = sha256Hex(derOf(pem));
    dependencies = buildValidHandlerDependencies(csrBytes);
    await handlerConstructor(dependencies, buildS3Event(), context);
  };

  const resultRecord = () =>
    JSON.parse(putCallsOf(dependencies)[1]!.body as string) as {
      violations: ResultViolation[];
    };

  const completedEntry = () =>
    logEntriesOf(consoleSpies.info, 'CSR_VALIDATOR_COMPLETED')[0] as {
      checks: LoggedCheck[];
      violations: ResultViolation[];
    };

  beforeEach(() => {
    consoleSpies = spyOnConsole();
    context = buildLambdaContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Given a parseable CSR breaking three rules', () => {
    const brokenRules = ['KEY.CURVE', 'KEY.HASH', 'DN.C'];

    beforeEach(async () => {
      await invokeWith(
        await buildCsr({
          namedCurve: 'P-384',
          hash: 'SHA-384',
          subject: 'CN=DVS Acme Sub-CA, O=Acme Ltd, C=US',
        }),
      );
    });

    it('writes the uploaded bytes to failed/<sha256>.pem first', () => {
      expect(dependencies.putS3Object).toHaveBeenNthCalledWith(1, {
        bucket: VALIDATED_BUCKET,
        key: `failed/${sha256}.pem`,
        body: csrBytes,
        contentType: 'application/x-pem-file',
      });
    });

    it('then writes the fail result record with every violation', () => {
      const [, recordCall] = putCallsOf(dependencies);
      const record = resultRecord();

      expect(putCallsOf(dependencies)).toHaveLength(2);
      expect(recordCall!.key).toBe(`failed/${sha256}.json`);
      expect(recordCall!.contentType).toBe('application/json');
      expect(record).toStrictEqual({
        status: 'fail',
        sha256,
        subjectDn: 'CN=DVS Acme Sub-CA,O=Acme Ltd,C=US',
        violations: expect.any(Array),
      });
      expect(record.violations.map(({ rule }) => rule).sort()).toStrictEqual(
        [...brokenRules].sort(),
      );
    });

    it('records each violation as exactly { rule, message }', () => {
      for (const violation of resultRecord().violations) {
        expect(Object.keys(violation)).toStrictEqual(['rule', 'message']);
        expect(violation.message).not.toBe('');
      }
    });

    it('writes nothing under validated/', () => {
      for (const { key } of putCallsOf(dependencies)) {
        expect(key.startsWith('failed/')).toBe(true);
      }
    });

    it('logs COMPLETED with outcome fail and the source and result keys', () => {
      expect(completedEntry()).toMatchObject({
        message: 'CSR validation complete',
        outcome: 'fail',
        sourceBucket: SOURCE_BUCKET,
        sourceKey: 'incoming/org.pem',
        sourceVersionId: VERSION_ID,
        sha256,
        resultKey: `failed/${sha256}.json`,
        subjectDn: 'CN=DVS Acme Sub-CA,O=Acme Ltd,C=US',
      });
    });

    it('logs the same violations as the result record', () => {
      expect(completedEntry().violations).toStrictEqual(
        resultRecord().violations,
      );
    });

    it('logs all 10 checks, each failed one carrying its violation message', () => {
      const { checks, violations } = completedEntry();

      expect(checks).toHaveLength(10);
      for (const { rule, message } of violations) {
        expect(checks.find((check) => check.rule === rule)).toMatchObject({
          status: 'failed',
          message,
        });
      }
      expect(checks.filter(({ status }) => status === 'failed')).toHaveLength(
        brokenRules.length,
      );
    });

    it('does not log the PEM or its base64 body', () => {
      expectNoCsrMaterialLogged(consoleSpies, pem);
    });
  });

  describe('Given a CSR with the archived five-attribute subject', () => {
    beforeEach(async () => {
      await invokeWith(
        await buildCsr({ subject: ARCHIVED_FIVE_ATTRIBUTE_SUBJECT }),
      );
    });

    it('writes a fail record under failed/<sha256> with a null subjectDn', () => {
      const [pemCall, recordCall] = putCallsOf(dependencies);

      expect(pemCall!.key).toBe(`failed/${sha256}.pem`);
      expect(recordCall!.key).toBe(`failed/${sha256}.json`);
      expect(JSON.parse(recordCall!.body as string)).toMatchObject({
        status: 'fail',
        sha256,
        subjectDn: null,
      });
    });

    it('reports the DN.ATTRIBUTES violation', () => {
      expect(resultRecord().violations.map(({ rule }) => rule)).toContain(
        'DN.ATTRIBUTES',
      );
    });

    it('logs COMPLETED without a subjectDn', () => {
      expect(completedEntry()).toMatchObject({ outcome: 'fail', sha256 });
      expect(completedEntry()).not.toHaveProperty('subjectDn');
    });
  });

  describe('Given a PEM block whose body is not a PKCS#10 request', () => {
    beforeEach(async () => {
      await invokeWith(toPem(toBytes('this is not DER at all')));
    });

    it('keys the outputs by the SHA-256 of the decoded body', () => {
      const [pemCall, recordCall] = putCallsOf(dependencies);

      expect(pemCall!.key).toBe(`failed/${sha256}.pem`);
      expect(recordCall!.key).toBe(`failed/${sha256}.json`);
    });

    it('writes a fail record with one FORMAT.PKCS10 violation', () => {
      expect(JSON.parse(putCallsOf(dependencies)[1]!.body as string)).toEqual({
        status: 'fail',
        sha256,
        subjectDn: null,
        violations: [{ rule: 'FORMAT.PKCS10', message: expect.any(String) }],
      });
    });
  });
});
