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
    const message = buildNotification(
      source,
      outcomeWith({ status: 'pass', sha256: 'deadbeef' }),
    );

    it('includes the original source key', () => {
      expect(message).toContain('*Original:* incoming/org.pem');
    });

    it('includes the SHA-256 fingerprint', () => {
      expect(message).toContain('*SHA-256:* deadbeef');
    });

    it('shows a pass status', () => {
      expect(message).toContain('*Status:* :white_check_mark: pass');
    });
  });

  describe('Given a failing outcome', () => {
    const message = buildNotification(
      source,
      outcomeWith({ status: 'fail', sha256: 'cafe' }),
    );

    it('shows a fail status', () => {
      expect(message).toContain('*Status:* :x: fail');
    });
  });

  describe('Given a failure with no fingerprint', () => {
    const message = buildNotification(
      source,
      outcomeWith({ status: 'fail', sha256: null }),
    );

    it('renders the SHA-256 as N/A rather than null', () => {
      expect(message).toContain('*SHA-256:* N/A');
    });
  });
});
