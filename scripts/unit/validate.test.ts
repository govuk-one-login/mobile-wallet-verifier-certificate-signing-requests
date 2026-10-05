import { describe, it, expect, vi } from 'vitest';
import {
  validatePem,
  printReport,
} from '../lib/verify-csr/validate.js';
import type { ValidationReport } from '../lib/verify-csr/types.js';

// ── validatePem — invalid PEM ───────────────────────────────────────

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

// ── printReport ─────────────────────────────────────────────────────

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
