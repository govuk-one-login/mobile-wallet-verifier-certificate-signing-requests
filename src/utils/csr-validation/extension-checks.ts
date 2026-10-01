import { AsnConvert } from '@peculiar/asn1-schema';
import { CertificationRequest } from '@peculiar/asn1-csr';
import { Extensions } from '@peculiar/asn1-x509';
import type { Reporter } from './reporter.ts';
import type { ExtensionDetail } from './types.ts';

/** Well-known extensions named in the report; every extension is prohibited. */
const TRACKED_EXTENSIONS: { oid: string; name: string }[] = [
  { oid: '2.5.29.19', name: 'basicConstraints' },
  { oid: '2.5.29.15', name: 'keyUsage' },
  { oid: '2.5.29.37', name: 'extendedKeyUsage' },
  { oid: '2.5.29.32', name: 'certificatePolicies' },
  { oid: '2.5.29.30', name: 'nameConstraints' },
  { oid: '2.5.29.36', name: 'policyConstraints' },
];

/** PKCS#9 extensionRequest and Microsoft msCertExtensions attribute types. */
const EXTENSION_ATTRIBUTE_OIDS = new Set([
  '1.2.840.113549.1.9.14',
  '1.3.6.1.4.1.311.2.1.14',
]);

/**
 * Rejects any CSR that requests certificate extensions. The DVS Sub-CA
 * policy forbids requesters from declaring capabilities — they are set by
 * the issuing CA. Every value of every extension-bearing attribute is read,
 * not only the first one a CSR library would expose.
 *
 * Returns per-extension presence detail for the report.
 */
export function checkNoExtensions(
  rawCsr: Uint8Array,
  reporter: Reporter,
): ExtensionDetail[] {
  reporter.markEvaluated('EXT.NONE');
  const { oids, malformed } = readRequestedExtensions(rawCsr);
  if (malformed > 0) {
    reporter.add({
      rule: 'EXT.NONE',
      message: `CSR contains ${malformed} malformed extension request value(s).`,
    });
  }
  if (oids.length > 0) {
    reporter.add({
      rule: 'EXT.NONE',
      message: `CSR must contain no certificate extensions; found ${oids.length}: [${oids.map(extensionName).join(', ')}].`,
    });
  }
  return buildDetails(oids);
}

function readRequestedExtensions(rawCsr: Uint8Array): {
  oids: string[];
  malformed: number;
} {
  const csrAsn = AsnConvert.parse(rawCsr, CertificationRequest);
  const oids: string[] = [];
  let malformed = 0;
  for (const attr of csrAsn.certificationRequestInfo.attributes) {
    if (!EXTENSION_ATTRIBUTE_OIDS.has(attr.type)) continue;
    for (const value of attr.values) {
      try {
        const extensions = AsnConvert.parse(value, Extensions);
        oids.push(...extensions.map((ext) => ext.extnID));
      } catch {
        malformed++;
      }
    }
  }
  return { oids, malformed };
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
