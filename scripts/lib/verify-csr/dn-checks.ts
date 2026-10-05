import { AsnConvert } from '@peculiar/asn1-schema';
import { CertificationRequest } from '@peculiar/asn1-csr';
import type { Reporter } from './reporter.js';
import type { CheckStatus, DnAttribute } from './types.js';

const OID_C = '2.5.4.6';
const OID_O = '2.5.4.10';
const OID_OU = '2.5.4.11';
const OID_CN = '2.5.4.3';
const OID_SERIAL = '2.5.4.5';

const MANDATORY_OIDS = new Set([OID_C, OID_O, OID_OU, OID_CN, OID_SERIAL]);

const REQUIRED_COUNTRY = 'GB';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface ParsedAttribute {
  oid: string;
  value: string;
}

/** Order in which DN attributes are displayed in the report. */
const DN_DISPLAY_ORDER: { oid: string; name: string }[] = [
  { oid: OID_C, name: 'C' },
  { oid: OID_O, name: 'O' },
  { oid: OID_OU, name: 'OU' },
  { oid: OID_CN, name: 'CN' },
  { oid: OID_SERIAL, name: 'serialNumber' },
];

/**
 * Validates that the Subject DN contains exactly the 5 mandatory
 * attributes (C, O, OU, CN, serialNumber) — no extras, no missing,
 * no duplicates — and that each value satisfies its content rule.
 */
export function checkSubjectDn(
  rawCsr: Uint8Array,
  reporter: Reporter,
): DnAttribute[] {
  reporter.markEvaluated('DN.ATTRIBUTES');
  const attrs = parseSubject(rawCsr);
  if (!checkAttributeSet(attrs, reporter)) {
    return buildDnAttributes(attrs, 'skipped');
  }
  reporter.markEvaluated('DN.C', 'DN.NONEMPTY', 'DN.SERIAL_UUIDV4');
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
  if (oid === OID_SERIAL) {
    return reporter.hasViolation('DN.SERIAL_UUIDV4') ? 'failed' : 'passed';
  }
  return reporter.hasViolation('DN.NONEMPTY') &&
    (!value || value.trim().length === 0)
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

/** ASN.1 DirectoryString variants exposed by @peculiar/asn1-x509. */
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
    oids.length !== 5
  ) {
    reporter.add({
      rule: 'DN.ATTRIBUTES',
      severity: 'error',
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
    `Subject DN must contain exactly 5 attributes ` +
      `(C, O, OU, CN, serialNumber); found ${total}.`,
  ];
  if (missing.length)
    parts.push(`Missing: [${missing.map(oidLabel).join(', ')}].`);
  if (extras.length)
    parts.push(`Unexpected: [${extras.map(oidLabel).join(', ')}].`);
  if (duplicates.length) {
    parts.push(
      `Duplicate: [${[...new Set(duplicates)].map(oidLabel).join(', ')}].`,
    );
  }
  return parts.join(' ');
}

function checkAttributeValues(
  attrs: ParsedAttribute[],
  reporter: Reporter,
): void {
  for (const { oid, value } of attrs) {
    if (oid === OID_C) checkCountry(value, reporter);
    else if (oid === OID_SERIAL) checkSerial(value, reporter);
    else checkNonEmpty(oid, value, reporter);
  }
}

function checkCountry(value: string, reporter: Reporter): void {
  if (value !== REQUIRED_COUNTRY) {
    reporter.add({
      rule: 'DN.C',
      severity: 'error',
      message: `Subject 'C' must be '${REQUIRED_COUNTRY}'; found '${value}'.`,
    });
  }
}

function checkSerial(value: string, reporter: Reporter): void {
  if (!UUID_V4_RE.test(value)) {
    reporter.add({
      rule: 'DN.SERIAL_UUIDV4',
      severity: 'error',
      message: `Subject 'serialNumber' must be a UUID v4; found '${value}'.`,
    });
  }
}

function checkNonEmpty(oid: string, value: string, reporter: Reporter): void {
  if (!value || value.trim().length === 0) {
    reporter.add({
      rule: 'DN.NONEMPTY',
      severity: 'error',
      message: `Subject '${oidLabel(oid)}' must be a non-empty string.`,
    });
  }
}

function oidLabel(oid: string): string {
  switch (oid) {
    case OID_C:
      return 'C';
    case OID_O:
      return 'O';
    case OID_OU:
      return 'OU';
    case OID_CN:
      return 'CN';
    case OID_SERIAL:
      return 'serialNumber';
    default:
      return oid;
  }
}
