/**
 * OpenSSL interop tests.
 *
 * Asserts that CSRs produced by a real `openssl req` invocation are
 * accepted (or rejected) by the validator exactly as the synthetic
 * fixtures are.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateCsrText } from '../validate-csr.ts';
import { REQUIRED_COUNTRY } from '../dn-checks.ts';
import type { ValidationReport } from '../types.ts';

const opensslAvailable = (() => {
  const probe = spawnSync('openssl', ['version'], { stdio: 'ignore' });
  return probe.status === 0;
})();

const describeIfOpenssl = opensslAvailable ? describe : describe.skip;

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'csr-openssl-interop-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

interface OpensslCsrOptions {
  curve: 'prime256v1' | 'secp384r1' | 'secp256k1';
  digest: '-sha256' | '-sha384';
  subject: string;
  extensionsConfig?: string;
}

function generateOpensslCsr(name: string, opts: OpensslCsrOptions): string {
  const keyPath = join(workDir, `${name}.key`);
  const csrPath = join(workDir, `${name}.pem`);
  execFileSync('openssl', [
    'ecparam',
    '-name',
    opts.curve,
    '-genkey',
    '-noout',
    '-out',
    keyPath,
  ]);
  const args = ['req', '-new', '-key', keyPath, opts.digest, '-out', csrPath];
  if (opts.extensionsConfig) {
    args.push('-config', opts.extensionsConfig);
  } else {
    args.push('-subj', opts.subject);
  }
  execFileSync('openssl', args);
  return csrPath;
}

function generateOpensslRsaCsr(name: string, subject: string): string {
  const keyPath = join(workDir, `${name}.key`);
  const csrPath = join(workDir, `${name}.pem`);
  execFileSync('openssl', ['genrsa', '-out', keyPath, '2048'], {
    stdio: 'ignore',
  });
  execFileSync('openssl', [
    'req',
    '-new',
    '-key',
    keyPath,
    '-sha256',
    '-out',
    csrPath,
    '-subj',
    subject,
  ]);
  return csrPath;
}

function dvsSubject(): string {
  return `/CN=DVS Acme Sub-CA/O=Acme Ltd/C=${REQUIRED_COUNTRY}`;
}

async function validateGenerated(path: string): Promise<ValidationReport> {
  return validateCsrText(await readFile(path, 'utf8'));
}

describeIfOpenssl('OpenSSL interop', () => {
  it('accepts a real openssl-generated P-256 / SHA-256 CSR', async () => {
    const path = generateOpensslCsr('interop-p256', {
      curve: 'prime256v1',
      digest: '-sha256',
      subject: dvsSubject(),
    });
    const report = await validateGenerated(path);
    expect(report.passed, JSON.stringify(report.violations, null, 2)).toBe(
      true,
    );
  });

  it('rejects a real openssl-generated P-384 / SHA-384 CSR', async () => {
    const path = generateOpensslCsr('interop-p384', {
      curve: 'secp384r1',
      digest: '-sha384',
      subject: dvsSubject(),
    });
    const report = await validateGenerated(path);
    expect(report.passed).toBe(false);
    const rules = report.violations.map((v) => v.rule);
    expect(rules).toContain('KEY.CURVE');
    expect(rules).toContain('KEY.HASH');
  });

  it('rejects a real openssl-generated P-384 / SHA-256 CSR (curve only)', async () => {
    const path = generateOpensslCsr('interop-p384-sha256', {
      curve: 'secp384r1',
      digest: '-sha256',
      subject: dvsSubject(),
    });
    const report = await validateGenerated(path);
    expect(report.passed).toBe(false);
    const rules = report.violations.map((v) => v.rule);
    expect(rules).toContain('KEY.CURVE');
    expect(rules).not.toContain('KEY.HASH');
  });

  it('rejects a real openssl-generated secp256k1 CSR (256-bit but not P-256)', async () => {
    const path = generateOpensslCsr('interop-secp256k1', {
      curve: 'secp256k1',
      digest: '-sha256',
      subject: dvsSubject(),
    });
    const report = await validateGenerated(path);
    expect(report.passed).toBe(false);
    // secp256k1 also fails signature verification under WebCrypto, so assert
    // KEY.CURVE is among the violations rather than the only one.
    expect(report.violations.map((v) => v.rule)).toContain('KEY.CURVE');
  });

  it('rejects a real openssl-generated P-256 CSR signed with SHA-384', async () => {
    const path = generateOpensslCsr('interop-mismatch', {
      curve: 'prime256v1',
      digest: '-sha384',
      subject: dvsSubject(),
    });
    const report = await validateGenerated(path);
    expect(report.passed).toBe(false);
    expect(report.violations.map((v) => v.rule)).toContain('KEY.HASH');
  });

  it('rejects a real openssl-generated RSA CSR', async () => {
    const path = generateOpensslRsaCsr('interop-rsa', dvsSubject());
    const report = await validateGenerated(path);
    expect(report.passed).toBe(false);
    expect(report.violations.map((v) => v.rule)).toContain('KEY.TYPE_EC');
  });

  it('rejects a real openssl-generated CSR with basicConstraints + keyUsage extensions', async () => {
    const cnfPath = join(workDir, 'interop-ext.cnf');
    await writeFile(
      cnfPath,
      [
        '[req]',
        'distinguished_name = dn',
        'req_extensions = v3_req',
        'prompt = no',
        '[dn]',
        'CN = DVS Ext Sub-CA',
        'O = Ext Org',
        `C = ${REQUIRED_COUNTRY}`,
        '[v3_req]',
        'basicConstraints = critical,CA:TRUE,pathlen:0',
        'keyUsage = critical,keyCertSign,cRLSign',
        '',
      ].join('\n'),
      'utf8',
    );
    const path = generateOpensslCsr('interop-ext', {
      curve: 'prime256v1',
      digest: '-sha256',
      subject: '',
      extensionsConfig: cnfPath,
    });
    const report = await validateGenerated(path);
    expect(report.passed).toBe(false);
    const ext = report.violations.find((v) => v.rule === 'EXT.NONE');
    expect(ext).toBeDefined();
    expect(ext!.message).toContain('basicConstraints');
    expect(ext!.message).toContain('keyUsage');
  });
});
