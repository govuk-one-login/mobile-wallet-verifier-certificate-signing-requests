import { createHash } from 'node:crypto';

/**
 * Returns the lowercase hex SHA-256 digest of the CSR's DER bytes — equal to
 * `openssl req -outform DER | sha256sum`.
 */
export function sha256Hex(der: Uint8Array): string {
  return createHash('sha256').update(der).digest('hex');
}
