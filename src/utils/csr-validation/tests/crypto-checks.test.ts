import { describe, it, expect } from 'vitest';
import type { Pkcs10CertificateRequest } from '@peculiar/x509';
import { checkCryptoProfile } from '../crypto-checks.ts';
import { Reporter } from '../reporter.ts';

const csrWithSignatureHash = (hash: unknown): Pkcs10CertificateRequest =>
  ({
    publicKey: { algorithm: { name: 'ECDSA', namedCurve: 'P-256' } },
    signatureAlgorithm: { hash },
  }) as unknown as Pkcs10CertificateRequest;

const runOn = (hash: unknown): Reporter => {
  const reporter = new Reporter();
  checkCryptoProfile(csrWithSignatureHash(hash), reporter);
  return reporter;
};

describe('checkCryptoProfile — signature hash parameters', () => {
  it.each([
    { scenario: 'the hash is absent', hash: undefined },
    { scenario: 'the hash is null', hash: null },
    { scenario: 'the hash is an object with no name', hash: {} },
  ])('reports KEY.HASH when $scenario', ({ hash }) => {
    const reporter = runOn(hash);

    expect(reporter.hasViolation('KEY.HASH')).toBe(true);
    expect(
      reporter.violations.find((violation) => violation.rule === 'KEY.HASH'),
    ).toMatchObject({
      message: 'CSR signature algorithm has no hash parameters.',
    });
  });

  it('reports KEY.HASH when a named hash is not SHA-256', () => {
    const reporter = runOn({ name: 'SHA-384' });

    expect(
      reporter.violations.find((violation) => violation.rule === 'KEY.HASH'),
    ).toMatchObject({
      message: "CSR signature hash must be SHA-256; found 'SHA-384'.",
    });
  });

  it('accepts a hash supplied as a plain string', () => {
    const reporter = runOn('SHA-256');

    expect(reporter.hasViolation('KEY.HASH')).toBe(false);
    expect(reporter.passed).toBe(true);
  });

  it('reports KEY.HASH when a string hash is not SHA-256', () => {
    const reporter = runOn('SHA-1');

    expect(
      reporter.violations.find((violation) => violation.rule === 'KEY.HASH'),
    ).toMatchObject({
      message: "CSR signature hash must be SHA-256; found 'SHA-1'.",
    });
  });
});
