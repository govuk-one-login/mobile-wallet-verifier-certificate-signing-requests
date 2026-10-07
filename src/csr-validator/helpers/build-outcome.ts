import { formatSubjectDn } from '../../utils/csr-validation/format-subject-dn.ts';
import type {
  RuleResult,
  ValidationReport,
  Violation,
} from '../../utils/csr-validation/types.ts';
import type { CsrSource } from './parse-s3-record.ts';

const VALIDATED_PREFIX = 'validated';
const FAILED_PREFIX = 'failed';

export type ValidationStatus = 'pass' | 'fail';

export type ResultRecord = {
  status: ValidationStatus;
  sha256: string | null;
  subjectDn: string | null;
  violations: Violation[];
};

export type OutcomeLogFields = Omit<ResultRecord, 'status'> & {
  outcome: ValidationStatus;
  resultKey: string;
  checks: RuleResult[];
};

export type ValidationOutcome = {
  pemKey: string;
  resultKey: string;
  resultRecord: ResultRecord;
  logFields: OutcomeLogFields;
};

export const buildOutcome = (
  source: CsrSource,
  report: ValidationReport,
): ValidationOutcome => {
  const resultRecord = buildResultRecord(report);
  const keyStem = buildKeyStem(source, report);
  const resultKey = `${keyStem}.json`;

  return {
    pemKey: `${keyStem}.pem`,
    resultKey,
    resultRecord,
    logFields: buildLogFields(resultRecord, resultKey, report),
  };
};

const buildKeyStem = (source: CsrSource, report: ValidationReport): string => {
  if (!report.passed) {
    return `${FAILED_PREFIX}/${report.sha256 ?? source.keyStem}`;
  }
  if (report.sha256 === undefined) {
    throw new Error('Validation report passed without a SHA-256 fingerprint');
  }
  return `${VALIDATED_PREFIX}/${report.sha256}`;
};

const buildResultRecord = (report: ValidationReport): ResultRecord => ({
  status: report.passed ? 'pass' : 'fail',
  sha256: report.sha256 ?? null,
  subjectDn: getSubjectDn(report),
  violations: report.violations,
});

const getSubjectDn = (report: ValidationReport): string | null => {
  const attributeSetPassed = report.checks.some(
    (check) => check.rule === 'DN.ATTRIBUTES' && check.status === 'passed',
  );
  if (!attributeSetPassed || report.metadata === undefined) {
    return null;
  }
  return formatSubjectDn(report.metadata.subjectDn);
};

const buildLogFields = (
  resultRecord: ResultRecord,
  resultKey: string,
  report: ValidationReport,
): OutcomeLogFields => {
  const { status, ...recordFields } = resultRecord;
  return {
    ...recordFields,
    outcome: status,
    resultKey,
    checks: report.checks,
  };
};
