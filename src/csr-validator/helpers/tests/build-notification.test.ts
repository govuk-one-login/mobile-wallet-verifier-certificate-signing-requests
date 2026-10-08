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

type ChatbotPayload = {
  version: string;
  source: string;
  content: { textType?: string; title?: string; description: string };
};

const payloadOf = (message: string): ChatbotPayload =>
  JSON.parse(message) as ChatbotPayload;

describe('buildNotification', () => {
  describe('AWS Chatbot custom-notification schema', () => {
    const { message } = buildNotification(
      source,
      outcomeWith({ status: 'pass', sha256: 'deadbeef' }),
    );
    const payload = payloadOf(message);

    it('is valid JSON', () => {
      expect(() => payloadOf(message)).not.toThrow();
    });

    it('declares the mandatory version and source Chatbot requires', () => {
      expect(payload.version).toBe('1.0');
      expect(payload.source).toBe('custom');
    });

    it('provides the mandatory content.description', () => {
      expect(typeof payload.content.description).toBe('string');
      expect(payload.content.description.length).toBeGreaterThan(0);
    });

    it('renders in the chat client markdown', () => {
      expect(payload.content.textType).toBe('client-markdown');
    });
  });

  describe('Given a topic ARN', () => {
    const { message } = buildNotification(
      source,
      outcomeWith({ status: 'pass', sha256: 'abc' }),
      'arn:aws:sns:eu-west-2:123456789012:alerting-warning',
    );
    const { title } = payloadOf(message).content;

    it('includes the region and account from the ARN in the title', () => {
      expect(title).toContain('eu-west-2');
      expect(title).toContain('Account: 123456789012');
    });
  });

  describe('Given no topic ARN', () => {
    const { message } = buildNotification(
      source,
      outcomeWith({ status: 'pass', sha256: 'abc' }),
    );
    const { title } = payloadOf(message).content;

    it('omits the region/account context without breaking the title', () => {
      expect(title).toContain('CSR Validation Passed');
      expect(title).not.toContain('Account:');
    });
  });

  describe('Given a passing outcome', () => {
    const { subject, message } = buildNotification(
      source,
      outcomeWith({ status: 'pass', sha256: 'deadbeef' }),
    );
    const { description, title } = payloadOf(message).content;

    it('summarises pass and the source key in the subject', () => {
      expect(subject).toBe('CSR validation passed: incoming/org.pem');
    });

    it('builds an icon-prefixed title in the house format', () => {
      expect(title).toContain(':white_check_mark:');
      expect(title).toContain('CSR Validation Passed');
    });

    it('includes the original source key without the incoming/ prefix', () => {
      expect(description).toContain('*Original filename:* `org.pem`');
    });

    it('shows the SHA-256 as the stored .pem object name', () => {
      expect(description).toContain('*SHA-256 filename:* deadbeef.pem');
    });

    it('includes the pass status in the description', () => {
      expect(description).toContain('*Status:* pass');
    });

    it('omits the runbook line when no runbook URL is configured', () => {
      expect(description).not.toContain('*Runbook:*');
    });
  });

  describe('Given a runbook URL', () => {
    const { message } = buildNotification(
      source,
      outcomeWith({ status: 'pass', sha256: 'abc' }),
      undefined,
      'https://runbook.example/csr',
    );
    const { description } = payloadOf(message).content;

    it('includes the runbook line in the description', () => {
      expect(description).toContain('*Runbook:* https://runbook.example/csr');
    });
  });

  describe('Given a failing outcome', () => {
    const { subject, message } = buildNotification(
      source,
      outcomeWith({ status: 'fail', sha256: 'cafe' }),
    );
    const { description, title } = payloadOf(message).content;

    it('summarises fail in the subject', () => {
      expect(subject).toBe('CSR validation failed: incoming/org.pem');
    });

    it('builds an icon-prefixed fail title', () => {
      expect(title).toContain(':x:');
      expect(title).toContain('CSR Validation Failed');
    });

    it('includes the fail status in the description', () => {
      expect(description).toContain('*Status:* fail');
    });
  });

  describe('Given a failure with no fingerprint', () => {
    const { message } = buildNotification(
      source,
      outcomeWith({ status: 'fail', sha256: null }),
    );

    it('renders the SHA-256 as N/A rather than null', () => {
      expect(payloadOf(message).content.description).toContain(
        '*SHA-256 filename:* N/A',
      );
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
