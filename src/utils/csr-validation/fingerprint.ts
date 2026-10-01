import { createHash } from 'node:crypto';

export function sha256Hex(der: Uint8Array): string {
  return createHash('sha256').update(der).digest('hex');
}
