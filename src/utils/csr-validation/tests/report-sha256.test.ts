import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../fingerprint.ts';
import { validateCsrText } from '../validate-csr.ts';
import { buildCsr, derOf, toPem } from './utils/builders.ts';

describe('validateCsrText — report sha256', () => {
  it('is the SHA-256 of the DER for a passing CSR', async () => {
    const pem = await buildCsr();

    const report = await validateCsrText(pem);

    expect(report.passed).toBe(true);
    expect(report.sha256).toBe(sha256Hex(derOf(pem)));
    expect(report.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is set for a parseable CSR that breaks the policy', async () => {
    const pem = await buildCsr({ namedCurve: 'P-384' });

    const report = await validateCsrText(pem);

    expect(report.passed).toBe(false);
    expect(report.sha256).toBe(sha256Hex(derOf(pem)));
  });

  it('is set when the PEM body decodes but is not a PKCS#10 request', async () => {
    const body = new TextEncoder().encode('not a certification request');

    const report = await validateCsrText(toPem(body));

    expect(report.violations.map((v) => v.rule)).toEqual(['FORMAT.PKCS10']);
    expect(report.sha256).toBe(sha256Hex(body));
  });

  it('does not depend on PEM line endings or surrounding whitespace', async () => {
    const pem = await buildCsr();
    const reformatted = `\n${pem.replaceAll('\n', '\r\n')}\r\n`;

    const report = await validateCsrText(reformatted);

    expect(report.sha256).toBe(sha256Hex(derOf(pem)));
  });

  it.each([
    { scenario: 'junk text', text: 'not a PEM file' },
    { scenario: 'an empty file', text: '' },
    {
      scenario: 'a PEM block with a non-base64 body',
      text: '-----BEGIN CERTIFICATE REQUEST-----\n!!!\n-----END CERTIFICATE REQUEST-----\n',
    },
  ])('is absent when PEM decoding fails for $scenario', async ({ text }) => {
    const report = await validateCsrText(text);

    expect(report.violations.map((v) => v.rule)).toEqual(['FORMAT.PEM']);
    expect(report).not.toHaveProperty('sha256');
  });

  it('never quotes the PEM markers in the FORMAT.PEM message', async () => {
    const report = await validateCsrText('not a PEM file');

    expect(report.violations[0]!.message).toMatch(
      /^File is not a single PEM-encoded CSR\./,
    );
    expect(report.violations[0]!.message).not.toContain('-----');
  });
});
