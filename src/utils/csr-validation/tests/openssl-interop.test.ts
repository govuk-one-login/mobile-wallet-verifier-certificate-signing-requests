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
  const serial = '8b1f9c4e-2d44-4a76-9c1b-2f1a3b4c5d6e';
  return (
    `/C=${REQUIRED_COUNTRY}/O=Acme Ltd/OU=DVS PKI Operations` +
    `/CN=DVS Acme Sub-CA/serialNumber=${serial}`
  );
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

  it('accepts a real openssl-generated CSR with only basicConstraints CA:TRUE', async () => {
    const serial = '8b1f9c4e-2d44-4a76-9c1b-2f1a3b4c5d6e';
    const cnfPath = join(workDir, 'interop-bc.cnf');
    await writeFile(
      cnfPath,
      [
        '[req]',
        'distinguished_name = dn',
        'req_extensions = v3_req',
        'prompt = no',
        '[dn]',
        `C = ${REQUIRED_COUNTRY}`,
        'O = Acme Ltd',
        'OU = DVS PKI Operations',
        'CN = DVS Ext Sub-CA',
        `serialNumber = ${serial}`,
        '[v3_req]',
        'basicConstraints = critical,CA:TRUE,pathlen:0',
        '',
      ].join('\n'),
      'utf8',
    );
    const path = generateOpensslCsr('interop-bc', {
      curve: 'prime256v1',
      digest: '-sha256',
      subject: '',
      extensionsConfig: cnfPath,
    });
    const report = await validateGenerated(path);
    expect(report.passed, JSON.stringify(report.violations, null, 2)).toBe(
      true,
    );
  });

  it('rejects a real openssl-generated CSR with a prohibited keyUsage extension', async () => {
    const serial = '8b1f9c4e-2d44-4a76-9c1b-2f1a3b4c5d6e';
    const cnfPath = join(workDir, 'interop-ext.cnf');
    await writeFile(
      cnfPath,
      [
        '[req]',
        'distinguished_name = dn',
        'req_extensions = v3_req',
        'prompt = no',
        '[dn]',
        `C = ${REQUIRED_COUNTRY}`,
        'O = Ext Org',
        'OU = DVS PKI Operations',
        'CN = DVS Ext Sub-CA',
        `serialNumber = ${serial}`,
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
    const extViolations = report.violations.filter(
      (v) => v.rule === 'EXT.PERMITTED',
    );
    expect(extViolations.length).toBeGreaterThan(0);
    expect(extViolations.some((v) => v.message.includes('keyUsage'))).toBe(
      true,
    );
    expect(
      extViolations.some((v) =>
        v.message.includes('must not contain the basicConstraints'),
      ),
    ).toBe(false);
  });
});
