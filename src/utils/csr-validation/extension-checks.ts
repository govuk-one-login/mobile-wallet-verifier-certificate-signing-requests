import { AsnConvert } from '@peculiar/asn1-schema';
import { CertificationRequest } from '@peculiar/asn1-csr';
import { Extensions } from '@peculiar/asn1-x509';
import type {
  BasicConstraintsExtension,
  Pkcs10CertificateRequest,
} from '@peculiar/x509';
import type { Reporter } from './reporter.ts';
import type { ExtensionDetail } from './types.ts';

const BASIC_CONSTRAINTS_OID = '2.5.29.19';
const STANDARD_EXTENSION_REQUEST_OID = '1.2.840.113549.1.9.14';
const MS_CERT_EXTENSIONS_OID = '1.3.6.1.4.1.311.2.1.14';

const TRACKED_EXTENSIONS: { oid: string; name: string }[] = [
  { oid: BASIC_CONSTRAINTS_OID, name: 'basicConstraints' },
  { oid: '2.5.29.15', name: 'keyUsage' },
  { oid: '2.5.29.37', name: 'extendedKeyUsage' },
  { oid: '2.5.29.32', name: 'certificatePolicies' },
  { oid: '2.5.29.30', name: 'nameConstraints' },
  { oid: '2.5.29.36', name: 'policyConstraints' },
];

const EXTENSION_ATTRIBUTE_OIDS = new Set([
  STANDARD_EXTENSION_REQUEST_OID,
  MS_CERT_EXTENSIONS_OID,
]);

/**
 * Validates the extensions requested in a Sub-CA CSR.
 *
 * The only extension a requester may include is basicConstraints, and only when
 * requested through the standard PKCS#9 extensionRequest attribute. Many CA
 * implementations (e.g. AWS Private CA) automatically add
 * `basicConstraints: CA:TRUE` to the CSR they generate for us to sign, so
 * rejecting it outright is incorrect. As the issuing CA we always set the
 * path length ourselves (pathLen 0 for an L3), so we:
 *   - accept basicConstraints with CA:TRUE and no pathLen, or pathLen 0
 *   - reject basicConstraints with CA:FALSE, or a pathLen >= 1
 *   - reject any other extension
 *
 * Returns per-extension presence detail for the job summary.
 */
export function checkPermittedExtensions(
  rawCsr: Uint8Array,
  csr: Pkcs10CertificateRequest,
  reporter: Reporter,
): ExtensionDetail[] {
  reporter.markEvaluated('EXT.PERMITTED');
  const { oids, malformed, basicConstraintsViaStandardRequest } =
    readRequestedExtensions(rawCsr);
  if (malformed > 0) {
    reporter.add({
      rule: 'EXT.PERMITTED',
      message: `CSR contains ${malformed} malformed extension request value(s).`,
    });
  }

  const prohibited = oids.filter(
    (oid) =>
      oid !== BASIC_CONSTRAINTS_OID ||
      (oid === BASIC_CONSTRAINTS_OID && !basicConstraintsViaStandardRequest),
  );
  const uniqueProhibited = [...new Set(prohibited)];
  for (const oid of uniqueProhibited) {
    reporter.add({
      rule: 'EXT.PERMITTED',
      message:
        oid === BASIC_CONSTRAINTS_OID
          ? 'CSR must request basicConstraints via the standard extensionRequest attribute; only basicConstraints (CA) is permitted.'
          : `CSR must not contain the ${extensionName(oid)} extension; only basicConstraints (CA) is permitted.`,
    });
  }

  if (basicConstraintsViaStandardRequest) {
    validateBasicConstraints(csr, reporter);
  }

  return buildDetails(oids);
}

function readRequestedExtensions(rawCsr: Uint8Array): {
  oids: string[];
  malformed: number;
  basicConstraintsViaStandardRequest: boolean;
} {
  const csrAsn = AsnConvert.parse(rawCsr, CertificationRequest);
  const oids: string[] = [];
  let malformed = 0;
  let basicConstraintsViaStandardRequest = false;
  for (const attr of csrAsn.certificationRequestInfo.attributes) {
    if (!EXTENSION_ATTRIBUTE_OIDS.has(attr.type)) continue;
    const isStandardRequest = attr.type === STANDARD_EXTENSION_REQUEST_OID;
    for (const value of attr.values) {
      const parsed = parseExtensionValue(value, isStandardRequest);
      if (parsed.malformed) {
        malformed++;
        continue;
      }
      oids.push(...parsed.oids);
      if (parsed.basicConstraintsViaStandardRequest) {
        basicConstraintsViaStandardRequest = true;
      }
    }
  }
  return { oids, malformed, basicConstraintsViaStandardRequest };
}

function parseExtensionValue(
  value: ArrayBuffer,
  isStandardRequest: boolean,
): {
  oids: string[];
  malformed: boolean;
  basicConstraintsViaStandardRequest: boolean;
} {
  try {
    const extensions = AsnConvert.parse(value, Extensions);
    const oids = extensions.map((ext) => ext.extnID);
    const basicConstraintsViaStandardRequest =
      isStandardRequest && oids.includes(BASIC_CONSTRAINTS_OID);
    return { oids, malformed: false, basicConstraintsViaStandardRequest };
  } catch {
    return {
      oids: [],
      malformed: true,
      basicConstraintsViaStandardRequest: false,
    };
  }
}

function validateBasicConstraints(
  csr: Pkcs10CertificateRequest,
  reporter: Reporter,
): void {
  const basicConstraints = csr.getExtension(
    BASIC_CONSTRAINTS_OID,
  ) as BasicConstraintsExtension | null;
  if (!basicConstraints) {
    reporter.add({
      rule: 'EXT.PERMITTED',
      message: 'CSR basicConstraints extension could not be parsed.',
    });
    return;
  }

  if (!basicConstraints.ca) {
    reporter.add({
      rule: 'EXT.PERMITTED',
      message:
        'CSR basicConstraints must assert CA:TRUE when signing a CA certificate.',
    });
    return;
  }

  if (
    basicConstraints.pathLength !== undefined &&
    basicConstraints.pathLength >= 1
  ) {
    reporter.add({
      rule: 'EXT.PERMITTED',
      message: `CSR basicConstraints requests pathLen ${basicConstraints.pathLength}; only pathLen 0 (or unset) is supported.`,
    });
  }
}

function buildDetails(oids: string[]): ExtensionDetail[] {
  const present = new Set(oids);
  const details: ExtensionDetail[] = TRACKED_EXTENSIONS.map(
    ({ oid, name }) => ({ name, oid, present: present.has(oid) }),
  );
  for (const oid of present) {
    if (!TRACKED_EXTENSIONS.some((t) => t.oid === oid)) {
      details.push({ name: oid, oid, present: true });
    }
  }
  return details;
}

function extensionName(oid: string): string {
  return TRACKED_EXTENSIONS.find((t) => t.oid === oid)?.name ?? oid;
}
