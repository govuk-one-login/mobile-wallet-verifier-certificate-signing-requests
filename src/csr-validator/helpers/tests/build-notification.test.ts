import { describe, it, expect } from 'vitest';
import { buildNotification } from '../build-notification.ts';
import type { CsrSource } from '../parse-s3-record.ts';
import type { ValidationOutcome } from '../build-outcome.ts';

const source: CsrSource = {
  bucket: 'mock-csr-received-bucket',
  key: 'incoming/org.pem',
  versionId: 'mockVersionId',
  keyStem: 'incoming/org',
};

const outcomeWith = (
  overrides: Partial<ValidationOutcome['resultRecord']>,
): ValidationOutcome => ({
  pemKey: 'validated/abc.pem',
  resultKey: 'validated/abc.json',
  resultRecord: {
    status: 'pass',
    sha256: 'abc',
    subjectDn: null,
    violations: [],
    ...overrides,
  },
  logFields: {
    outcome: 'pass',
    resultKey: 'validated/abc.json',
    sha256: 'abc',
    subjectDn: null,
    violations: [],
    checks: [],
  },
});

describe('buildNotification', () => {
  describe('Given a passing outcome', () => {
    const { subject, message } = buildNotification(
      source,
      outcomeWith({ status: 'pass', sha256: 'deadbeef' }),
    );

    it('summarises pass and the source key in the subject', () => {
      expect(subject).toBe('CSR validation passed: incoming/org.pem');
    });

    it('includes the original source key in the message', () => {
      expect(message).toContain('Original: incoming/org.pem');
    });

    it('includes the SHA-256 fingerprint in the message', () => {
      expect(message).toContain('SHA-256: deadbeef');
    });

    it('includes the pass status in the message', () => {
      expect(message).toContain('Status: pass');
    });
  });

  describe('Given a failing outcome', () => {
    const { subject, message } = buildNotification(
      source,
      outcomeWith({ status: 'fail', sha256: 'cafe' }),
    );

    it('summarises fail in the subject', () => {
      expect(subject).toBe('CSR validation failed: incoming/org.pem');
    });

    it('includes the fail status in the message', () => {
      expect(message).toContain('Status: fail');
    });
  });

  describe('Given a failure with no fingerprint', () => {
    const { message } = buildNotification(
      source,
      outcomeWith({ status: 'fail', sha256: null }),
    );

    it('renders the SHA-256 as N/A rather than null', () => {
      expect(message).toContain('SHA-256: N/A');
    });
  });

  describe('Given a source key that would exceed the SNS subject limit', () => {
    const longKey = `incoming/${'a'.repeat(200)}.pem`;
    const { subject } = buildNotification(
      { ...source, key: longKey },
      outcomeWith({ status: 'pass', sha256: 'abc' }),
    );

    it('truncates the subject to at most 100 ASCII characters', () => {
      expect(subject.length).toBeLessThanOrEqual(100);
      expect(subject.endsWith('...')).toBe(true);
      // eslint-disable-next-line no-control-regex
      expect(subject).toMatch(/^[\x00-\x7F]*$/);
    });
  });
});
