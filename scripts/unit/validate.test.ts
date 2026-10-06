import { describe, it, expect, vi } from 'vitest';
import {
  validatePem,
  printReport,
} from '../lib/verify-csr/validate.js';
import type { ValidationReport } from '../lib/verify-csr/types.js';

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

const VALID_CSR_PEM = [
  '-----BEGIN CERTIFICATE REQUEST-----',
  'MIIBRzCB7gIBADCBizELMAkGA1UEBhMCR0IxEjAQBgNVBAoMCUdyZWF0IERWUzEV',
  'MBMGA1UECwwMR3JlYXQgRFZTIENBMSIwIAYDVQQDDBlHcmVhdCBEVlMgVmVyaWZp',
  'ZXIgU3ViLUNBMS0wKwYDVQQFEyQ1NTBlODQwMC1lMjliLTQxZDQtYTcxNi00NDY2',
  'NTU0NDAwMDAwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASFm2lS+Q4G18nUR//d',
  'K2XHoDPVkVmlqzSHExKW1pianYmB62beqBazp21MLhByv4dfvnL/Ucd1wzPz3Ad2',
  'kQ1ToAAwCgYIKoZIzj0EAwIDSAAwRQIgUJpP8LHhSFXN+G0vMSvi8yfZJE1+jg+l',
  'CMS/YHoDXq4CIQDGClORDVUFpVorVFSJ9k65BfLKjaPwy0GHlwkkc+tfpA==',
  '-----END CERTIFICATE REQUEST-----',
].join('\n');

describe('validatePem — full pipeline (real CSR)', () => {
  it('passes all checks with a valid P-256 CSR', async () => {
    const report = await validatePem(VALID_CSR_PEM, 'valid.pem');

    expect(report.passed).toBe(true);
    expect(report.file).toBe('valid.pem');
    expect(report.violations).toEqual([]);
  });

  it('has every rule with status "passed"', async () => {
    const report = await validatePem(VALID_CSR_PEM, 'valid.pem');

    expect(report.checks.length).toBe(11);
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
