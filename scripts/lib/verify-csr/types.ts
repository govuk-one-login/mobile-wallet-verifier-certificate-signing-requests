/**
 * Shared types for the CSR validator.
 */

export type Severity = 'error';

export type CheckStatus = 'passed' | 'failed' | 'skipped';

export type RuleId =
  | 'FORMAT.PEM'
  | 'FORMAT.PKCS10'
  | 'FORMAT.SIGNATURE'
  | 'KEY.TYPE_EC'
  | 'KEY.CURVE'
  | 'KEY.HASH'
  | 'DN.ATTRIBUTES'
  | 'DN.C'
  | 'DN.NONEMPTY'
  | 'DN.SERIAL_UUIDV4'
  | 'EXT.NONE';

export interface RuleDefinition {
  rule: RuleId;
  label: string;
  section: string;
}

export interface Violation {
  rule: RuleId;
  severity: Severity;
  message: string;
}

export interface RuleResult {
  rule: RuleId;
  label: string;
  section: string;
  status: CheckStatus;
  message?: string;
}

export interface DnAttribute {
  name: string;
  oid: string;
  value: string;
  status: CheckStatus;
}

export interface ExtensionDetail {
  name: string;
  oid: string;
  present: boolean;
}

export interface CsrMetadata {
  subjectDn: DnAttribute[];
  extensions: ExtensionDetail[];
}

export interface ValidationReport {
  file: string;
  passed: boolean;
  violations: Violation[];
  checks: RuleResult[];
  metadata?: CsrMetadata;
}
