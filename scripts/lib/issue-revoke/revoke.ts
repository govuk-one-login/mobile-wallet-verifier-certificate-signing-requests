import {
  ACMPCAClient,
  RevokeCertificateCommand,
  RevocationReason,
} from '@aws-sdk/client-acm-pca';
import { AWS_REGION, COLON_HEX_SERIAL_RE } from './constants.js';

const VALID_REASONS = Object.values(RevocationReason);

export function isValidReason(
  r: string,
): r is (typeof RevocationReason)[keyof typeof RevocationReason] {
  return VALID_REASONS.includes(
    r as (typeof RevocationReason)[keyof typeof RevocationReason],
  );
}

export function validateSerialFormat(serial: string): void {
  if (!COLON_HEX_SERIAL_RE.test(serial)) {
    throw new Error(
      `Invalid certificate serial format: expected colon-separated hex ` +
        `(e.g. "aa:bb:cc"), got "${serial}"`,
    );
  }
}

export async function revokeCertificate(
  caArn: string,
  certificateSerial: string,
  reason: RevocationReason,
): Promise<void> {
  validateSerialFormat(certificateSerial);
  const pca = new ACMPCAClient({ region: AWS_REGION });
  await pca.send(
    new RevokeCertificateCommand({
      CertificateAuthorityArn: caArn,
      CertificateSerial: certificateSerial,
      RevocationReason: reason,
    }),
  );
}

export { VALID_REASONS };
