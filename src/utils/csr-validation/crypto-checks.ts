import type { Pkcs10CertificateRequest } from '@peculiar/x509';
import type { Reporter } from './reporter.ts';

const REQUIRED_CURVE = 'P-256';
const REQUIRED_HASH = 'SHA-256';

export async function checkCryptoProfile(
  csr: Pkcs10CertificateRequest,
  reporter: Reporter,
): Promise<void> {
  reporter.markEvaluated('KEY.TYPE_EC');
  const algorithm = csr.publicKey.algorithm;
  if (algorithm.name !== 'ECDSA') {
    reporter.add({
      rule: 'KEY.TYPE_EC',
      message: `Public key algorithm must be EC (ECDSA); found '${algorithm.name}'.`,
    });
    // Keep downstream profile rules skipped after an unsupported key type.
    return;
  }
  reporter.markEvaluated('KEY.CURVE', 'KEY.HASH');
  const curve = (algorithm as KeyAlgorithm & { namedCurve: string }).namedCurve;
  checkCurve(curve, reporter);
  checkSignatureHash(csr, reporter);
}

function checkCurve(curve: string, reporter: Reporter): void {
  if (curve !== REQUIRED_CURVE) {
    reporter.add({
      rule: 'KEY.CURVE',
      message: `EC curve must be ${REQUIRED_CURVE}; found '${curve}'.`,
    });
  }
}

function checkSignatureHash(
  csr: Pkcs10CertificateRequest,
  reporter: Reporter,
): void {
  const hashName = readHashName(csr.signatureAlgorithm.hash);
  if (!hashName) {
    reporter.add({
      rule: 'KEY.HASH',
      message: 'CSR signature algorithm has no hash parameters.',
    });
    return;
  }
  if (hashName !== REQUIRED_HASH) {
    reporter.add({
      rule: 'KEY.HASH',
      message: `CSR signature hash must be ${REQUIRED_HASH}; found '${hashName}'.`,
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
        message:
          'CSR signature failed to verify against the embedded public key.',
      });
    }
  } catch (err) {
    reporter.add({
      rule: 'FORMAT.SIGNATURE',
      message: `CSR signature verification threw an error: ${(err as Error).message}`,
    });
  }
}
