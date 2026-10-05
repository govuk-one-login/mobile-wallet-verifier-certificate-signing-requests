/**
 * CSR validation — in-memory variant.
 *
 * `validatePem()` accepts a PEM string directly (e.g. fetched from S3)
 * instead of reading from the local filesystem.  No `fs` module is
 * imported anywhere in this module.
 */
import 'reflect-metadata';
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { Reporter } from './reporter.js';
import { decodePem } from './pem.js';
import { checkCryptoProfile, checkSignature } from './crypto-checks.js';
import { checkSubjectDn } from './dn-checks.js';
import { checkNoExtensions } from './extension-checks.js';
import type {
  CheckStatus,
  CsrMetadata,
  RuleDefinition,
  RuleResult,
  ValidationReport,
} from './types.js';

x509.cryptoProvider.set(webcrypto as Crypto);

const RULE_DEFINITIONS: readonly RuleDefinition[] = [
  {
    rule: 'FORMAT.PEM',
    label: 'PEM-encoded CSR',
    section: 'CSR format',
  },
  {
    rule: 'FORMAT.PKCS10',
    label: 'Valid PKCS#10 structure',
    section: 'CSR format',
  },
  {
    rule: 'FORMAT.SIGNATURE',
    label: 'Self-signature verification',
    section: 'CSR format',
  },
  {
    rule: 'KEY.TYPE_EC',
    label: 'Key type is EC (ECDSA)',
    section: 'Key algorithm',
  },
  {
    rule: 'KEY.CURVE',
    label: 'Curve is P-256 or P-384',
    section: 'Key algorithm',
  },
  {
    rule: 'KEY.HASH',
    label: 'Curve/hash pairing (RFC 5480)',
    section: 'Key algorithm',
  },
  {
    rule: 'DN.ATTRIBUTES',
    label: 'Exactly 5 DN attributes (C, O, OU, CN, serialNumber)',
    section: 'Subject DN',
  },
  {
    rule: 'DN.C',
    label: 'Country code is GB',
    section: 'Subject DN',
  },
  {
    rule: 'DN.NONEMPTY',
    label: 'DN values are non-empty',
    section: 'Subject DN',
  },
  {
    rule: 'DN.SERIAL_UUIDV4',
    label: 'serialNumber is a UUID v4',
    section: 'Subject DN',
  },
  {
    rule: 'EXT.NONE',
    label: 'No certificate extensions',
    section: 'Extensions',
  },
] as const;

// In-memory validation

/**
 * Validates a PEM-encoded CSR string entirely in memory.
 *
 * @param pemContent - The PEM string (e.g. downloaded from S3)
 * @param label      - A display label for the report (e.g. filename)
 */
export async function validatePem(
  pemContent: string,
  label: string,
): Promise<ValidationReport> {
  const reporter = new Reporter();
  let metadata: CsrMetadata | undefined;

  const der = decodePem(pemContent, reporter);
  if (!der) {
    return finalise(label, reporter, metadata);
  }

  metadata = await runChecks(der, reporter);
  return finalise(label, reporter, metadata);
}

// Internal helpers

async function runChecks(
  der: Uint8Array,
  reporter: Reporter,
): Promise<CsrMetadata | undefined> {
  const csr = parseCsr(der, reporter);
  if (!csr) return undefined;
  await checkSignature(csr, reporter);
  await checkCryptoProfile(csr, reporter);
  const subjectDn = checkSubjectDn(der, reporter);
  const extensions = checkNoExtensions(csr, reporter);
  return { subjectDn, extensions };
}

function parseCsr(
  der: Uint8Array,
  reporter: Reporter,
): x509.Pkcs10CertificateRequest | null {
  reporter.markEvaluated('FORMAT.PKCS10');
  try {
    return new x509.Pkcs10CertificateRequest(der.buffer as ArrayBuffer);
  } catch (err) {
    reporter.add({
      rule: 'FORMAT.PKCS10',
      severity: 'error',
      message:
        `Failed to parse as PKCS#10 CertificationRequest: ` +
        `${(err as Error).message}`,
    });
    return null;
  }
}

function finalise(
  label: string,
  reporter: Reporter,
  metadata?: CsrMetadata,
): ValidationReport {
  const violations = [...reporter.violations];
  const failedRules = new Set(violations.map((v) => v.rule));
  const checks: RuleResult[] = RULE_DEFINITIONS.map((def) => {
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
      label: def.label,
      section: def.section,
      status,
      ...(violation ? { message: violation.message } : {}),
    };
  });
  return {
    file: label,
    passed: reporter.passed,
    violations,
    checks,
    ...(metadata ? { metadata } : {}),
  };
}

// Report printing

export function printReport(report: ValidationReport): void {
  if (report.passed) {
    console.log(`✓ ${report.file}: all checks passed`);
    return;
  }
  console.log(`✗ ${report.file}: ${report.violations.length} violation(s)`);
  for (const v of report.violations) {
    console.log(`  [${v.rule}] ${v.message}`);
  }
}
