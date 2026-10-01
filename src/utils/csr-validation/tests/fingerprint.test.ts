import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sha256Hex } from '../fingerprint.ts';
import { buildCsr, derOf } from './utils/builders.ts';
import { validateCsrText } from '../validate-csr.ts';

const opensslAvailable =
  spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;

const describeIfOpenssl = opensslAvailable ? describe : describe.skip;

describe('sha256Hex', () => {
  it('matches the known SHA-256 vector for "abc"', () => {
    const bytes = new TextEncoder().encode('abc');
    expect(sha256Hex(bytes)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the known SHA-256 vector for empty input', () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('returns 64 lowercase hex characters', async () => {
    const der = derOf(await buildCsr());
    expect(sha256Hex(der)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describeIfOpenssl('sha256Hex — OpenSSL interop', () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'csr-fingerprint-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('equals the digest of `openssl req -outform DER` for a passing CSR', async () => {
    const pem = await buildCsr();
    const report = await validateCsrText(pem);
    expect(report.passed, JSON.stringify(report.violations)).toBe(true);
    const pemPath = join(workDir, 'csr.pem');
    await writeFile(pemPath, pem, 'utf8');
    const opensslDer = execFileSync('openssl', [
      'req',
      '-in',
      pemPath,
      '-outform',
      'DER',
    ]);
    const opensslDigest = execFileSync('openssl', ['dgst', '-sha256', '-r'], {
      input: opensslDer,
    })
      .toString()
      .split(' ')[0];

    const der = derOf(pem);
    expect(sha256Hex(der)).toBe(opensslDigest);
  });
});
