/**
 * DVS Organisation CA CSR validator — pure validation, no I/O.
 */
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { AsnConvert } from '@peculiar/asn1-schema';
import { CertificationRequest } from '@peculiar/asn1-csr';
import { errorResult, Result, successResult } from '../result/result.ts';
import { Reporter } from './reporter.ts';
import { decodePem } from './pem.ts';
import { sha256Hex } from './fingerprint.ts';
import { checkCryptoProfile, checkSignature } from './crypto-checks.ts';
import { checkSubjectDn } from './dn-checks.ts';
import { checkNoExtensions } from './extension-checks.ts';
import type {
  CheckStatus,
  CsrMetadata,
  RuleDefinition,
  RuleId,
  RuleResult,
  ValidationReport,
  Violation,
} from './types.ts';

export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
  { rule: 'FORMAT.PEM', section: 'CSR format' },
  {
    rule: 'FORMAT.PKCS10',
    section: 'CSR format',
  },
  {
    rule: 'FORMAT.SIGNATURE',
    section: 'CSR format',
  },
  {
    rule: 'KEY.TYPE_EC',
    section: 'Key algorithm',
  },
  { rule: 'KEY.CURVE', section: 'Key algorithm' },
  {
    rule: 'KEY.HASH',
    section: 'Key algorithm',
  },
  {
    rule: 'DN.ATTRIBUTES',
    section: 'Subject DN',
  },
  {
    rule: 'DN.C',
    section: 'Subject DN',
  },
  {
    rule: 'DN.NONEMPTY',
    section: 'Subject DN',
  },
  {
    rule: 'EXT.NONE',
    section: 'Extensions',
  },
] as const;

/**
 * Validates PEM text against the DVS CSR policy, collecting every violation
 * in one pass. Never throws for a bad CSR — violations are data.
 */
export async function validateCsrText(text: string): Promise<ValidationReport> {
  const reporter = new Reporter();
  const pemResult = decodePem(text);
  if (pemResult.isError) {
    reporter.add({
      rule: 'FORMAT.PEM',
      message: pemResult.value,
    });
    return finalise(reporter);
  }
  reporter.markEvaluated('FORMAT.PEM');
  const der = pemResult.value;
  const metadata = await runChecks(der, reporter);
  return finalise(reporter, { metadata, sha256: sha256Hex(der) });
}

async function runChecks(
  der: Uint8Array,
  reporter: Reporter,
): Promise<CsrMetadata | undefined> {
  reporter.markEvaluated('FORMAT.PKCS10');
  const csrResult = parseCsr(der);
  if (csrResult.isError) {
    reporter.add({
      rule: 'FORMAT.PKCS10',
      message: csrResult.value,
    });
    return undefined;
  }
  const csr = csrResult.value;
  await checkSignature(csr, reporter);
  await guarded('KEY.TYPE_EC', reporter, undefined, () =>
    checkCryptoProfile(csr, reporter),
  );
  const subjectDn = await guarded('DN.ATTRIBUTES', reporter, [], () =>
    checkSubjectDn(der, reporter),
  );
  const extensions = await guarded('EXT.NONE', reporter, [], () =>
    checkNoExtensions(der, reporter),
  );
  return { subjectDn, extensions };
}

/**
 * Runs a check and records an unexpected exception (e.g. a CSR field the
 * library cannot decode) as a violation of `rule`, so a malformed CSR yields
 * a report instead of an error.
 */
async function guarded<T>(
  rule: RuleId,
  reporter: Reporter,
  fallback: T,
  check: () => T | Promise<T>,
): Promise<T> {
  try {
    return await check();
  } catch (err) {
    reporter.add({
      rule,
      message: `CSR could not be checked: ${(err as Error).message}`,
    });
    return fallback;
  }
}

function parseCsr(
  der: Uint8Array,
): Result<x509.Pkcs10CertificateRequest, string> {
  try {
    assertStrictDer(der);
    return successResult(
      new x509.Pkcs10CertificateRequest(der.buffer as ArrayBuffer),
    );
  } catch (err) {
    return errorResult(
      `Failed to parse as PKCS#10 CertificationRequest: ${(err as Error).message}`,
    );
  }
}

/**
 * Requires the bytes to be exactly one strict-DER CertificationRequest, so the
 * SHA-256 fingerprint matches `openssl req -outform DER`. Trailing bytes and
 * non-canonical (BER) encodings change on re-serialisation and are rejected.
 */
function assertStrictDer(der: Uint8Array): void {
  const parsed = AsnConvert.parse(der, CertificationRequest);
  const canonical = new Uint8Array(AsnConvert.serialize(parsed));
  if (!Buffer.from(canonical).equals(der)) {
    throw new Error(
      'encoding is not a single strict-DER CertificationRequest ' +
        '(trailing bytes or non-canonical encoding).',
    );
  }
}

function finalise(
  reporter: Reporter,
  decoded: { metadata?: CsrMetadata; sha256?: string } = {},
): ValidationReport {
  const violations = [...reporter.violations];
  const { metadata, sha256 } = decoded;
  return {
    passed: reporter.passed,
    violations,
    checks: buildChecks(reporter, violations),
    ...(metadata ? { metadata } : {}),
    ...(sha256 ? { sha256 } : {}),
  };
}

function buildChecks(
  reporter: Reporter,
  violations: readonly Violation[],
): RuleResult[] {
  const failedRules = new Set(violations.map((v) => v.rule));
  return RULE_DEFINITIONS.map((def) => {
    let status: CheckStatus;
    if (failedRules.has(def.rule)) {
      status = 'failed';
    } else if (reporter.wasEvaluated(def.rule)) {
      status = 'passed';
    } else {
      status = 'skipped';
    }
    const violation = violations.find((v) => v.rule === def.rule);
    return {
      rule: def.rule,
      section: def.section,
      status,
      ...(violation ? { message: violation.message } : {}),
    };
  });
}
