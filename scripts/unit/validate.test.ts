import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { validateCsrText } from '../../src/utils/csr-validation/validate-csr.js';
import { VALID_CSR_PEM } from './fixtures.js';

x509.cryptoProvider.set(webcrypto as Crypto);

// CSR generators for edge-case tests

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
      'C=GB, O=Test, OU=Test CA, CN=Test Sub-CA, ' +
        '2.5.4.5=550e8400-e29b-41d4-a716-446655440000',
    extensions: opts.extensions,
  });
  return csr.toString('pem');
}

// Invalid PEM

describe('validateCsrText — invalid PEM', () => {
  it('fails with FORMAT.PEM for random text', async () => {
    const report = await validateCsrText('not a pem');

    expect(report.passed).toBe(false);
    expect(report.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'FORMAT.PEM' })]),
    );
  });

  it('fails with FORMAT.PEM for empty string', async () => {
    const report = await validateCsrText('');

    expect(report.passed).toBe(false);
    expect(report.violations[0]?.rule).toBe('FORMAT.PEM');
  });

  it('fails for a non-CSR PEM block', async () => {
    const certPem = [
      '-----BEGIN CERTIFICATE-----',
      'MIIB+jCCAaCgAwIBAgIUfake==',
      '-----END CERTIFICATE-----',
    ].join('\n');

    const report = await validateCsrText(certPem);

    expect(report.passed).toBe(false);
    expect(report.violations[0]?.rule).toBe('FORMAT.PEM');
  });

  it('marks FORMAT.PEM as failed in the checks array', async () => {
    const report = await validateCsrText('junk');

    const pemCheck = report.checks.find((c) => c.rule === 'FORMAT.PEM');
    expect(pemCheck?.status).toBe('failed');
  });

  it('skips downstream rules when PEM fails', async () => {
    const report = await validateCsrText('junk');

    const downstream = report.checks.filter((c) => c.rule !== 'FORMAT.PEM');
    for (const check of downstream) {
      expect(check.status).toBe('skipped');
    }
  });
});

// Full pipeline with real CSR

describe('validateCsrText — full pipeline (real CSR)', () => {
  it('passes all checks with a valid P-256 CSR', async () => {
    const report = await validateCsrText(VALID_CSR_PEM);

    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it('has every rule with status "passed"', async () => {
    const report = await validateCsrText(VALID_CSR_PEM);

    expect(report.checks).toHaveLength(11);
    for (const check of report.checks) {
      expect(check.status, `expected rule ${check.rule} to pass`).toBe(
        'passed',
      );
    }
  });

  it('populates correct subject DN metadata', async () => {
    const report = await validateCsrText(VALID_CSR_PEM);

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
    const report = await validateCsrText(VALID_CSR_PEM);

    expect(report.metadata).toBeDefined();
    for (const ext of report.metadata!.extensions) {
      expect(ext.present).toBe(false);
    }
  });

  it('fails with FORMAT.PKCS10 for corrupted body', async () => {
    const corruptedPem = [
      '-----BEGIN CERTIFICATE REQUEST-----',
      'AAAA' + 'B'.repeat(60),
      'CCCC' + 'D'.repeat(60),
      '-----END CERTIFICATE REQUEST-----',
    ].join('\n');

    const report = await validateCsrText(corruptedPem);

    expect(report.passed).toBe(false);
    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'FORMAT.PKCS10' }),
      ]),
    );
  });
});

// DN validation errors

describe('validateCsrText — DN validation errors', () => {
  it('fails DN.C when country is not GB', async () => {
    const pem = await generateCsr({
      subject:
        'C=US, O=Test, OU=Test CA, CN=Test Sub-CA, ' +
        '2.5.4.5=550e8400-e29b-41d4-a716-446655440000',
    });
    const report = await validateCsrText(pem);

    expect(report.passed).toBe(false);
    const violation = report.violations.find((v) => v.rule === 'DN.C');
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('US');
  });

  it('fails DN.SERIAL_UUIDV4 for non-UUID serial', async () => {
    const pem = await generateCsr({
      subject:
        'C=GB, O=Test, OU=Test CA, CN=Test Sub-CA, ' + '2.5.4.5=not-a-uuid',
    });
    const report = await validateCsrText(pem);

    expect(report.passed).toBe(false);
    const violation = report.violations.find(
      (v) => v.rule === 'DN.SERIAL_UUIDV4',
    );
    expect(violation).toBeDefined();
  });

  it('fails DN.ATTRIBUTES when attribute is missing', async () => {
    const pem = await generateCsr({
      subject: 'C=GB, O=Test, CN=Test Sub-CA',
    });
    const report = await validateCsrText(pem);

    expect(report.passed).toBe(false);
    const violation = report.violations.find((v) => v.rule === 'DN.ATTRIBUTES');
    expect(violation).toBeDefined();
  });

  it('fails DN.ATTRIBUTES when extra attributes present', async () => {
    const pem = await generateCsr({
      subject:
        'C=GB, O=Test, OU=Test CA, CN=Test Sub-CA, ' +
        '2.5.4.5=550e8400-e29b-41d4-a716-446655440000, ' +
        'L=London',
    });
    const report = await validateCsrText(pem);

    expect(report.passed).toBe(false);
    const violation = report.violations.find((v) => v.rule === 'DN.ATTRIBUTES');
    expect(violation).toBeDefined();
  });
});

// Extension validation errors

describe('validateCsrText — extension validation errors', () => {
  it('fails EXT.PERMITTED when CSR has extensions', async () => {
    const pem = await generateCsr({
      extensions: [
        new x509.Extension('1.2.3.4.5', false, new Uint8Array([0x30, 0x00])),
      ],
    });
    const report = await validateCsrText(pem);

    expect(report.passed).toBe(false);
    const violation = report.violations.find((v) => v.rule === 'EXT.PERMITTED');
    expect(violation).toBeDefined();
  });
});

// PEM format errors

describe('validateCsrText — PEM format errors', () => {
  it('fails for invalid base64 body', async () => {
    const pem = [
      '-----BEGIN CERTIFICATE REQUEST-----',
      'QUFB=QQ==',
      '-----END CERTIFICATE REQUEST-----',
    ].join('\n');

    const report = await validateCsrText(pem);

    expect(report.passed).toBe(false);
    const failed = report.violations.some(
      (v) => v.rule === 'FORMAT.PEM' || v.rule === 'FORMAT.PKCS10',
    );
    expect(failed).toBe(true);
  });
});

// Crypto validation

describe('validateCsrText — crypto validation', () => {
  it('fails KEY.CURVE for P-384 (only P-256 allowed)', async () => {
    const pem = await generateCsr({
      algorithm: { name: 'ECDSA', namedCurve: 'P-384' },
      hash: 'SHA-384',
    });
    const report = await validateCsrText(pem);

    expect(report.passed).toBe(false);
    const curveViolation = report.violations.find(
      (v) => v.rule === 'KEY.CURVE',
    );
    expect(curveViolation).toBeDefined();
    expect(curveViolation!.message).toContain('P-384');
  });

  it('fails KEY.HASH for P-256 with SHA-384', async () => {
    const pem = await generateCsr({
      algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
      hash: 'SHA-384',
    });
    const report = await validateCsrText(pem);

    expect(report.passed).toBe(false);
    const violation = report.violations.find((v) => v.rule === 'KEY.HASH');
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('SHA-256');
  });
});
