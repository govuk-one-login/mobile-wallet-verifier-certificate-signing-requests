import { errorResult, Result, successResult } from '../result/result.ts';

/** One block whose body is one or more non-empty base64 lines. */
const PEM_RE =
  /^-----BEGIN CERTIFICATE REQUEST-----\r?\n((?:[A-Za-z0-9+/=]+\r?\n)+)-----END CERTIFICATE REQUEST-----\r?\n?$/;

/** Only ASCII whitespace may surround the block; OpenSSL rejects any other. */
const ASCII_WHITESPACE = new Set([' ', '\t', '\r', '\n']);

/**
 * Verifies that the input is a single, well-formed PEM-encoded CSR block
 * and returns the decoded DER bytes, or the reason the structure is invalid.
 * The reason is logged, so it never quotes the PEM markers or the input.
 */
export function decodePem(input: string): Result<Uint8Array, string> {
  const trimmed = trimAsciiWhitespace(input) + '\n';
  const match = PEM_RE.exec(trimmed);
  if (!match) {
    return errorResult(
      "File is not a single PEM-encoded CSR. Expected exactly one PEM block of type 'CERTIFICATE REQUEST'.",
    );
  }
  return decodeBase64Body(match[1]!);
}

function trimAsciiWhitespace(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && ASCII_WHITESPACE.has(input[start]!)) start++;
  while (end > start && ASCII_WHITESPACE.has(input[end - 1]!)) end--;
  return input.slice(start, end);
}

function decodeBase64Body(body: string): Result<Uint8Array, string> {
  const stripped = body.replaceAll(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(stripped) || stripped.length % 4 !== 0) {
    return errorResult('PEM body is not valid base64.');
  }
  return successResult(Uint8Array.from(Buffer.from(stripped, 'base64')));
}
