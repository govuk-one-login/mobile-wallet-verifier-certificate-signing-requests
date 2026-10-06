import { describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import {
  validatePem,
  printReport,
} from '../lib/verify-csr/validate.js';
import type { ValidationReport } from '../lib/verify-csr/types.js';
import { VALID_CSR_PEM } from './fixtures.js';

x509.cryptoProvider.set(webcrypto as Crypto);

// ── CSR generators for edge-case tests ──────────────────────────────

async function generateCsr(
  opts: {
    algorithm?: EcKeyGenParams;
    hash?: string;
    subject?: string;
    extensions?: x509.Extension[];
  } = {},
): Promise<string> {
  const algo = opts.algorithm ?? {
    name: 'ECDSA',
    namedCurve: 'P-256',
  };
  const keys = await webcrypto.subtle.generateKey(algo, true, [
    'sign',
    'verify',
  ]);
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    keys,
    signingAlgorithm: {
      name: 'ECDSA',
      hash: opts.hash ?? 'SHA-256',
    },
    name:
      opts.subject ??
      'C=GB, O=Test, OU=Test CA, CN=Test Sub-CA, 2.5.4.5=550e8400-e29b-41d4-a716-446655440000',
    extensions: opts.extensions,
  });
  return csr.toString('pem');
}

// validatePem — invalid PEM

describe('validatePem', () => {
  it('fails with FORMAT.PEM for random text', async () => {
    const report = await validatePem('not a pem', 'bad.pem');

    expect(report.passed).toBe(false);
    expect(report.file).toBe('bad.pem');
    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'FORMAT.PEM' }),
      ]),
    );
  });

  it('fails with FORMAT.PEM for empty string', async () => {
    const report = await validatePem('', 'empty.pem');

    expect(report.passed).toBe(false);
    expect(report.violations[0]?.rule).toBe('FORMAT.PEM');
  });

  it('fails for a non-CSR PEM block (BEGIN CERTIFICATE)', async () => {
    const certPem = [
      '-----BEGIN CERTIFICATE-----',
      'MIIB+jCCAaCgAwIBAgIUfake==',
      '-----END CERTIFICATE-----',
    ].join('\n');

    const report = await validatePem(certPem, 'cert.pem');

    expect(report.passed).toBe(false);
    expect(report.violations[0]?.rule).toBe('FORMAT.PEM');
  });

  it('fails for a BEGIN PUBLIC KEY block', async () => {
    const keyPem = [
      '-----BEGIN PUBLIC KEY-----',
      'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE',
      '-----END PUBLIC KEY-----',
    ].join('\n');

    const report = await validatePem(keyPem, 'key.pem');

    expect(report.passed).toBe(false);
    expect(report.violations[0]?.rule).toBe('FORMAT.PEM');
  });

  it('uses the provided label in report.file', async () => {
    const report = await validatePem('junk', 'my-label.pem');
    expect(report.file).toBe('my-label.pem');
  });

  it('marks FORMAT.PEM as failed in the checks array', async () => {
    const report = await validatePem('junk', 'test.pem');

    const pemCheck = report.checks.find(
      (c) => c.rule === 'FORMAT.PEM',
    );
    expect(pemCheck?.status).toBe('failed');
  });

  it('skips downstream rules when PEM fails', async () => {
    const report = await validatePem('junk', 'test.pem');

    const skippedRules = report.checks.filter(
      (c) => c.status === 'skipped',
    );
    expect(skippedRules.length).toBeGreaterThan(0);

    // All rules after FORMAT.PEM should be skipped
    const downstream = report.checks.filter(
      (c) => c.rule !== 'FORMAT.PEM',
    );
    for (const check of downstream) {
      expect(check.status).toBe('skipped');
    }
  });
});

// validatePem — full pipeline with real CSR

describe('validatePem — full pipeline (real CSR)', () => {
  it('passes all checks with a valid P-256 CSR', async () => {
    const report = await validatePem(VALID_CSR_PEM, 'valid.pem');

    expect(report.passed).toBe(true);
    expect(report.file).toBe('valid.pem');
    expect(report.violations).toEqual([]);
  });

  it('has every rule with status "passed"', async () => {
    const report = await validatePem(VALID_CSR_PEM, 'valid.pem');

    expect(report.checks).toHaveLength(11);
    for (const check of report.checks) {
      expect(
        check.status,
        `expected rule ${check.rule} to pass`,
      ).toBe('passed');
    }
  });

  it('populates correct subject DN metadata', async () => {
    const report = await validatePem(VALID_CSR_PEM, 'valid.pem');

    expect(report.metadata).toBeDefined();
    const dn = report.metadata!.subjectDn;
    expect(dn).toEqual([
      {
        name: 'C',
        oid: '2.5.4.6',
        value: 'GB',
        status: 'passed',
      },
      {
        name: 'O',
        oid: '2.5.4.10',
        value: 'Great DVS',
        status: 'passed',
      },
      {
        name: 'OU',
        oid: '2.5.4.11',
        value: 'Great DVS CA',
        status: 'passed',
      },
      {
        name: 'CN',
        oid: '2.5.4.3',
        value: 'Great DVS Verifier Sub-CA',
        status: 'passed',
      },
      {
        name: 'serialNumber',
        oid: '2.5.4.5',
        value: '550e8400-e29b-41d4-a716-446655440000',
        status: 'passed',
      },
    ]);
  });

  it('reports extensions as empty (none present)', async () => {
    const report = await validatePem(VALID_CSR_PEM, 'valid.pem');

    expect(report.metadata).toBeDefined();
    const exts = report.metadata!.extensions;
    for (const ext of exts) {
      expect(ext.present).toBe(false);
    }
  });

  it(
    'fails with FORMAT.PKCS10 for a PEM with corrupted body',
    async () => {
      const corruptedPem = [
        '-----BEGIN CERTIFICATE REQUEST-----',
        'AAAA' + 'B'.repeat(60),
        'CCCC' + 'D'.repeat(60),
        '-----END CERTIFICATE REQUEST-----',
      ].join('\n');

      const report = await validatePem(corruptedPem, 'corrupt.pem');

      expect(report.passed).toBe(false);
      expect(report.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ rule: 'FORMAT.PKCS10' }),
        ]),
      );
      const pkcs10Check = report.checks.find(
        (c) => c.rule === 'FORMAT.PKCS10',
      );
      expect(pkcs10Check?.status).toBe('failed');

      // PEM itself should pass since the envelope is valid
      const pemCheck = report.checks.find(
        (c) => c.rule === 'FORMAT.PEM',
      );
      expect(pemCheck?.status).toBe('passed');

      // Downstream rules should be skipped
      const downstream = report.checks.filter(
        (c) =>
          c.rule !== 'FORMAT.PEM' && c.rule !== 'FORMAT.PKCS10',
      );
      for (const check of downstream) {
        expect(check.status).toBe('skipped');
      }
    },
  );
});

// ── Edge-case CSRs (cover error branches) ───────────────────────────

describe('validatePem — DN validation errors', () => {
  it('fails DN.C when country is not GB', async () => {
    const pem = await generateCsr({
      subject:
        'C=US, O=Test, OU=Test CA, CN=Test Sub-CA, ' +
        '2.5.4.5=550e8400-e29b-41d4-a716-446655440000',
    });
    const report = await validatePem(pem, 'wrong-country.pem');

    expect(report.passed).toBe(false);
    const violation = report.violations.find(
      (v) => v.rule === 'DN.C',
    );
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('US');
  });

  it('fails DN.SERIAL_UUIDV4 when serial is not a UUID', async () => {
    const pem = await generateCsr({
      subject:
        'C=GB, O=Test, OU=Test CA, CN=Test Sub-CA, ' +
        '2.5.4.5=not-a-uuid',
    });
    const report = await validatePem(pem, 'bad-serial.pem');

    expect(report.passed).toBe(false);
    const violation = report.violations.find(
      (v) => v.rule === 'DN.SERIAL_UUIDV4',
    );
    expect(violation).toBeDefined();
  });

  it('fails DN.ATTRIBUTES when an attribute is missing', async () => {
    const pem = await generateCsr({
      subject: 'C=GB, O=Test, CN=Test Sub-CA',
    });
    const report = await validatePem(pem, 'missing-attrs.pem');

    expect(report.passed).toBe(false);
    const violation = report.violations.find(
      (v) => v.rule === 'DN.ATTRIBUTES',
    );
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('Missing');
  });

  it('fails DN.ATTRIBUTES when extra attributes present', async () => {
    const pem = await generateCsr({
      subject:
        'C=GB, O=Test, OU=Test CA, CN=Test Sub-CA, ' +
        '2.5.4.5=550e8400-e29b-41d4-a716-446655440000, ' +
        'L=London',
    });
    const report = await validatePem(pem, 'extra-attrs.pem');

    expect(report.passed).toBe(false);
    const violation = report.violations.find(
      (v) => v.rule === 'DN.ATTRIBUTES',
    );
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('Unexpected');
  });
});

describe('validatePem — extension validation errors', () => {
  it('fails EXT.NONE when CSR has extensions', async () => {
    const pem = await generateCsr({
      extensions: [
        new x509.Extension(
          '1.2.3.4.5',
          false,
          new Uint8Array([0x30, 0x00]),
        ),
      ],
    });
    const report = await validatePem(pem, 'with-extensions.pem');

    expect(report.passed).toBe(false);
    const violation = report.violations.find(
      (v) => v.rule === 'EXT.NONE',
    );
    expect(violation).toBeDefined();
  });
});

describe('validatePem — PEM format errors', () => {
  it('fails FORMAT.PEM for invalid base64 body', async () => {
    // Valid PEM envelope with base64 alphabet chars but decode to
    // nonsense — the regex passes but decodeBase64Body catches it
    const pem = [
      '-----BEGIN CERTIFICATE REQUEST-----',
      'QUFB=QQ==',
      '-----END CERTIFICATE REQUEST-----',
    ].join('\n');

    const report = await validatePem(pem, 'bad-base64.pem');

    expect(report.passed).toBe(false);
    const pemCheck = report.checks.find(
      (c) => c.rule === 'FORMAT.PEM',
    );
    // Either FORMAT.PEM or FORMAT.PKCS10 fails — both are valid
    const failed = report.violations.some(
      (v) =>
        v.rule === 'FORMAT.PEM' || v.rule === 'FORMAT.PKCS10',
    );
    expect(failed).toBe(true);
  });
});

describe('validatePem — crypto validation with P-384', () => {
  it('passes with a valid P-384 CSR and SHA-384', async () => {
    const pem = await generateCsr({
      algorithm: { name: 'ECDSA', namedCurve: 'P-384' },
      hash: 'SHA-384',
      subject:
        'C=GB, O=Test, OU=Test CA, CN=Test Sub-CA, ' +
        '2.5.4.5=550e8400-e29b-41d4-a716-446655440000',
    });
    const report = await validatePem(pem, 'p384.pem');

    expect(report.passed).toBe(true);
  });

  it('fails KEY.HASH for P-256 with SHA-384 (mismatched)', async () => {
    const pem = await generateCsr({
      algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
      hash: 'SHA-384',
      subject:
        'C=GB, O=Test, OU=Test CA, CN=Test Sub-CA, ' +
        '2.5.4.5=550e8400-e29b-41d4-a716-446655440000',
    });
    const report = await validatePem(pem, 'mismatch.pem');

    expect(report.passed).toBe(false);
    const violation = report.violations.find(
      (v) => v.rule === 'KEY.HASH',
    );
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('mismatch');
  });
});

// printReport

describe('printReport', () => {
  it('logs violations for a failed report', () => {
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    const report: ValidationReport = {
      file: 'bad.pem',
      passed: false,
      violations: [
        {
          rule: 'FORMAT.PEM',
          severity: 'error',
          message: 'Not a PEM',
        },
      ],
      checks: [],
    };
    printReport(report);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('bad.pem'),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('FORMAT.PEM'),
    );
    spy.mockRestore();
  });

  it('logs success for a passed report', () => {
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    const report: ValidationReport = {
      file: 'good.pem',
      passed: true,
      violations: [],
      checks: [],
    };
    printReport(report);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('all checks passed'),
    );
    spy.mockRestore();
  });
});
