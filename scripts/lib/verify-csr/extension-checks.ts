import type { Pkcs10CertificateRequest } from '@peculiar/x509';
import type { Reporter } from './reporter.js';
import type { ExtensionDetail } from './types.js';

/** Well-known extensions that are explicitly prohibited in Sub-CA CSRs. */
const TRACKED_EXTENSIONS: { oid: string; name: string }[] = [
  { oid: '2.5.29.19', name: 'basicConstraints' },
  { oid: '2.5.29.15', name: 'keyUsage' },
  { oid: '2.5.29.37', name: 'extendedKeyUsage' },
  { oid: '2.5.29.32', name: 'certificatePolicies' },
  { oid: '2.5.29.30', name: 'nameConstraints' },
  { oid: '2.5.29.36', name: 'policyConstraints' },
];

/**
 * Rejects any CSR that requests certificate extensions. The DVS Sub-CA
 * policy forbids requesters from declaring capabilities — they are set
 * by the issuing CA.
 *
 * Returns per-extension presence detail for the job summary.
 */
export function checkNoExtensions(
  csr: Pkcs10CertificateRequest,
  reporter: Reporter,
): ExtensionDetail[] {
  reporter.markEvaluated('EXT.NONE');
  const extensions = csr.extensions ?? [];
  const presentOids = new Set(extensions.map((ext) => ext.type));

  const details: ExtensionDetail[] = TRACKED_EXTENSIONS.map(
    ({ oid, name }) => ({
      name,
      oid,
      present: presentOids.has(oid),
    }),
  );

  // Detect any extensions not in the tracked list
  for (const ext of extensions) {
    if (!TRACKED_EXTENSIONS.some((t) => t.oid === ext.type)) {
      details.push({ name: ext.type, oid: ext.type, present: true });
    }
  }

  if (extensions.length > 0) {
    const named = extensions
      .map(
        (ext) =>
          TRACKED_EXTENSIONS.find((t) => t.oid === ext.type)?.name ??
          ext.type,
      )
      .join(', ');
    reporter.add({
      rule: 'EXT.NONE',
      severity: 'error',
      message:
        `CSR must contain no certificate extensions; ` +
        `found ${extensions.length}: [${named}].`,
    });
  }

  return details;
}
