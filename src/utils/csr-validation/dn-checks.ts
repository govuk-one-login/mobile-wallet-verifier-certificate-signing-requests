import { AsnConvert } from '@peculiar/asn1-schema';
import { CertificationRequest } from '@peculiar/asn1-csr';
import type { Reporter } from './reporter.ts';
import type { CheckStatus, DnAttribute } from './types.ts';

const OID_CN = '2.5.4.3';
const OID_O = '2.5.4.10';
const OID_C = '2.5.4.6';

export const REQUIRED_COUNTRY = 'GB';

const DN_DISPLAY_ORDER: { oid: string; name: string }[] = [
  { oid: OID_CN, name: 'CN' },
  { oid: OID_O, name: 'O' },
  { oid: OID_C, name: 'C' },
];

const MANDATORY_OIDS = new Set(DN_DISPLAY_ORDER.map(({ oid }) => oid));

interface ParsedAttribute {
  oid: string;
  value: string;
}

export function checkSubjectDn(
  rawCsr: Uint8Array,
  reporter: Reporter,
): DnAttribute[] {
  reporter.markEvaluated('DN.ATTRIBUTES');
  const attrs = parseSubject(rawCsr);
  if (!checkAttributeSet(attrs, reporter)) {
    return buildDnAttributes(attrs, 'skipped');
  }
  reporter.markEvaluated('DN.C', 'DN.NONEMPTY');
  checkAttributeValues(attrs, reporter);
  return buildDnAttributes(attrs, 'passed', reporter);
}

function buildDnAttributes(
  attrs: ParsedAttribute[],
  defaultStatus: CheckStatus,
  reporter?: Reporter,
): DnAttribute[] {
  return DN_DISPLAY_ORDER.map(({ oid, name }) => {
    const attr = attrs.find((a) => a.oid === oid);
    const value = attr?.value ?? '';
    let status = defaultStatus;
    if (reporter && attr) {
      status = getAttributeStatus(oid, value, reporter);
    }
    return { name, oid, value, status };
  });
}

function getAttributeStatus(
  oid: string,
  value: string,
  reporter: Reporter,
): CheckStatus {
  if (oid === OID_C) {
    return reporter.hasViolation('DN.C') ? 'failed' : 'passed';
  }
  return reporter.hasViolation('DN.NONEMPTY') && isBlank(value)
    ? 'failed'
    : 'passed';
}

function parseSubject(rawCsr: Uint8Array): ParsedAttribute[] {
  const csrAsn = AsnConvert.parse(rawCsr, CertificationRequest);
  const rdnSequence = csrAsn.certificationRequestInfo.subject;
  const out: ParsedAttribute[] = [];
  for (const rdn of rdnSequence) {
    for (const atv of rdn) {
      out.push({ oid: atv.type, value: extractStringValue(atv.value) });
    }
  }
  return out;
}

const ASN1_STRING_KEYS = [
  'printableString',
  'utf8String',
  'ia5String',
  'bmpString',
  'universalString',
] as const;

function extractStringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ASN1_STRING_KEYS) {
      if (typeof record[key] === 'string') return record[key];
    }
  }
  return '';
}

function checkAttributeSet(
  attrs: ParsedAttribute[],
  reporter: Reporter,
): boolean {
  const oids = attrs.map((a) => a.oid);
  const uniqueOids = new Set(oids);
  const missing = [...MANDATORY_OIDS].filter((oid) => !uniqueOids.has(oid));
  const extras = [...uniqueOids].filter((oid) => !MANDATORY_OIDS.has(oid));
  const duplicates = oids.filter((oid, i) => oids.indexOf(oid) !== i);

  if (
    missing.length ||
    extras.length ||
    duplicates.length ||
    oids.length !== MANDATORY_OIDS.size
  ) {
    reporter.add({
      rule: 'DN.ATTRIBUTES',
      message: buildAttributeSetMessage(
        missing,
        extras,
        duplicates,
        oids.length,
      ),
    });
    return false;
  }
  return true;
}

function buildAttributeSetMessage(
  missing: string[],
  extras: string[],
  duplicates: string[],
  total: number,
): string {
  const parts: string[] = [
    `Subject DN must contain exactly 3 attributes (CN, O, C); found ${total}.`,
  ];
  if (missing.length) {
    parts.push(`Missing: [${missing.map(oidLabel).join(', ')}].`);
  }
  if (extras.length) {
    parts.push(`Unexpected: [${extras.map(oidLabel).join(', ')}].`);
  }
  if (duplicates.length) {
    const unique = [...new Set(duplicates)].map(oidLabel).join(', ');
    parts.push(`Duplicate: [${unique}].`);
  }
  return parts.join(' ');
}

function checkAttributeValues(
  attrs: ParsedAttribute[],
  reporter: Reporter,
): void {
  for (const { oid, value } of attrs) {
    if (oid === OID_C) checkCountry(value, reporter);
    else checkNonEmpty(oid, value, reporter);
  }
}

function checkCountry(value: string, reporter: Reporter): void {
  if (value !== REQUIRED_COUNTRY) {
    reporter.add({
      rule: 'DN.C',
      message: `Subject 'C' must be '${REQUIRED_COUNTRY}'; found '${value}'.`,
    });
  }
}

function checkNonEmpty(oid: string, value: string, reporter: Reporter): void {
  if (isBlank(value)) {
    reporter.add({
      rule: 'DN.NONEMPTY',
      message: `Subject '${oidLabel(oid)}' must be a non-empty string.`,
    });
  }
}

function isBlank(value: string): boolean {
  return !value || value.trim().length === 0;
}

function oidLabel(oid: string): string {
  return DN_DISPLAY_ORDER.find((entry) => entry.oid === oid)?.name ?? oid;
}
