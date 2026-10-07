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
  | 'EXT.PERMITTED';

export interface RuleDefinition {
  rule: RuleId;
  section: string;
}

export interface Violation {
  rule: RuleId;
  message: string;
}

export interface RuleResult {
  rule: RuleId;
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
  passed: boolean;
  violations: Violation[];
  checks: RuleResult[];
  metadata?: CsrMetadata;
  sha256?: string;
}
