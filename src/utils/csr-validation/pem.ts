import { errorResult, Result, successResult } from '../result/result.ts';

const PEM_RE =
  /^-----BEGIN CERTIFICATE REQUEST-----\r?\n((?:[A-Za-z0-9+/=]+\r?\n)+)-----END CERTIFICATE REQUEST-----\r?\n?$/;

const ASCII_WHITESPACE = new Set([' ', '\t', '\r', '\n']);

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
