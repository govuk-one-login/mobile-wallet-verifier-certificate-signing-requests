import type { Pkcs10CertificateRequest } from '@peculiar/x509';
import type { Reporter } from './reporter.js';

const ALLOWED_PAIRINGS: Record<string, string> = {
  'P-256': 'SHA-256',
  'P-384': 'SHA-384',
};

/**
 * Validates the cryptographic profile: EC key, allowed curve, ECDSA
 * signature algorithm, and matching hash strength.
 */
export async function checkCryptoProfile(
  csr: Pkcs10CertificateRequest,
  reporter: Reporter,
): Promise<void> {
  reporter.markEvaluated('KEY.TYPE_EC');
  const algorithm = csr.publicKey.algorithm;
  if (algorithm.name !== 'ECDSA') {
    reporter.add({
      rule: 'KEY.TYPE_EC',
      severity: 'error',
      message:
        `Public key algorithm must be EC (ECDSA); ` +
        `found '${algorithm.name}'.`,
    });
    // Curve and hash pairing checks are semantically meaningless for
    // non-EC keys — stop here; KEY.CURVE and KEY.HASH remain skipped.
    return;
  }
  reporter.markEvaluated('KEY.CURVE', 'KEY.HASH');
  const curve = (algorithm as KeyAlgorithm & { namedCurve: string })
    .namedCurve;
  checkCurve(curve, reporter);
  checkPairing(curve, csr, reporter);
}

function checkCurve(curve: string, reporter: Reporter): void {
  if (curve !== 'P-256' && curve !== 'P-384') {
    reporter.add({
      rule: 'KEY.CURVE',
      severity: 'error',
      message: `EC curve must be P-256 or P-384; found '${curve}'.`,
    });
  }
}

/**
 * Enforces curve↔hash pairing per RFC 5480 §4: P-256 with SHA-256,
 * P-384 with SHA-384.
 */
function checkPairing(
  curve: string,
  csr: Pkcs10CertificateRequest,
  reporter: Reporter,
): void {
  const sigOid = readHashName(csr.signatureAlgorithm.hash);
  const expectedHash = ALLOWED_PAIRINGS[curve];
  if (!sigOid) {
    reporter.add({
      rule: 'KEY.HASH',
      severity: 'error',
      message: 'CSR signature algorithm has no hash parameters.',
    });
    return;
  }
  if (sigOid !== 'SHA-256' && sigOid !== 'SHA-384') {
    reporter.add({
      rule: 'KEY.HASH',
      severity: 'error',
      message:
        `Hash function must be SHA-256 or SHA-384; ` +
        `found '${sigOid}'.`,
    });
    return;
  }
  if (expectedHash && sigOid !== expectedHash) {
    reporter.add({
      rule: 'KEY.HASH',
      severity: 'error',
      message:
        `Curve/hash mismatch: ${curve} must be paired with ` +
        `${expectedHash} (RFC 5480 §4); found ${sigOid}.`,
    });
  }
}

function readHashName(hash: unknown): string | null {
  if (!hash) return null;
  if (typeof hash === 'string') return hash;
  if (typeof hash === 'object' && 'name' in hash) {
    return String(hash.name);
  }
  return null;
}

/**
 * Verifies the CSR self-signature over CertificationRequestInfo.
 */
export async function checkSignature(
  csr: Pkcs10CertificateRequest,
  reporter: Reporter,
): Promise<void> {
  reporter.markEvaluated('FORMAT.SIGNATURE');
  try {
    const ok = await csr.verify();
    if (!ok) {
      reporter.add({
        rule: 'FORMAT.SIGNATURE',
        severity: 'error',
        message:
          'CSR signature failed to verify against the embedded ' +
          'public key.',
      });
    }
  } catch (err) {
    reporter.add({
      rule: 'FORMAT.SIGNATURE',
      severity: 'error',
      message:
        `CSR signature verification threw an error: ` +
        `${(err as Error).message}`,
    });
  }
}
