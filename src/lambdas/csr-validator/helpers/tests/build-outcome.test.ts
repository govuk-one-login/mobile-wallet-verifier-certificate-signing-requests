import { describe, it, expect } from 'vitest';
import { buildOutcome } from '../build-outcome.ts';
import type { CsrSource } from '../parse-s3-record.ts';
import type { ValidationReport } from '../../../../utils/csr-validation/types.ts';

const source: CsrSource = {
  bucket: 'mock-csr-received-bucket',
  key: 'incoming/org.pem',
  versionId: 'mockVersionId',
  keyStem: 'incoming/org',
};

describe('buildOutcome', () => {
  describe('Given a report that passed without a SHA-256 fingerprint', () => {
    const report: ValidationReport = {
      passed: true,
      violations: [],
      checks: [],
    };

    it('throws rather than key a validated/ object by file name', () => {
      expect(() => buildOutcome(source, report)).toThrow(
        'Validation report passed without a SHA-256 fingerprint',
      );
    });
  });
});
