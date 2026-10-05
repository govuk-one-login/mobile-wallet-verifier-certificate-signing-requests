import type { Reporter } from './reporter.js';

const PEM_RE =
  /^-----BEGIN CERTIFICATE REQUEST-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END CERTIFICATE REQUEST-----\r?\n?$/;

/**
 * Verifies that the input is a single, well-formed PEM-encoded CSR block
 * and returns the decoded DER bytes. Records `FORMAT.PEM` and returns
 * `null` if the structure is invalid.
 */
export function decodePem(
  input: string,
  reporter: Reporter,
): Uint8Array | null {
  reporter.markEvaluated('FORMAT.PEM');
  const trimmed = input.trim() + '\n';
  const match = PEM_RE.exec(trimmed);
  if (!match) {
    reporter.add({
      rule: 'FORMAT.PEM',
      severity: 'error',
      message:
        'Input is not a single PEM-encoded CSR. Expected exactly one ' +
        "'-----BEGIN CERTIFICATE REQUEST-----' / " +
        "'-----END CERTIFICATE REQUEST-----' block.",
    });
    return null;
  }
  return decodeBase64Body(match[1]!, reporter);
}

function decodeBase64Body(body: string, reporter: Reporter): Uint8Array | null {
  const stripped = body.replaceAll(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(stripped)) {
    reporter.add({
      rule: 'FORMAT.PEM',
      severity: 'error',
      message: 'PEM body is not valid base64.',
    });
    return null;
  }
  return Uint8Array.from(Buffer.from(stripped, 'base64'));
}
