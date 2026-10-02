import { errorResult, Result, successResult } from '../result/result.ts';

const PEM_RE =
  /^-----BEGIN CERTIFICATE REQUEST-----\r?\n((?:[A-Za-z0-9+/=]+\r?\n)+)-----END CERTIFICATE REQUEST-----\r?\n?$/;

const LEADING_OR_TRAILING_ASCII_WHITESPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;

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
  return input.replace(LEADING_OR_TRAILING_ASCII_WHITESPACE, '');
}

function decodeBase64Body(body: string): Result<Uint8Array, string> {
  const stripped = body.replaceAll(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(stripped) || stripped.length % 4 !== 0) {
    return errorResult('PEM body is not valid base64.');
  }
  return successResult(Uint8Array.from(Buffer.from(stripped, 'base64')));
}
