import { describe, it, expect } from 'vitest';
import * as x509 from '@peculiar/x509';
import { validateCsrText } from '../validate-csr.ts';
import { REQUIRED_COUNTRY } from '../dn-checks.ts';
import type { RuleId, ValidationReport } from '../types.ts';
import { AsnConvert } from '@peculiar/asn1-schema';
import { Attribute, AttributeValue, Extensions } from '@peculiar/asn1-x509';
import { buildCsr, derOf, mutateCsr, toPem } from './utils/builders.ts';

const sha1SigningSupported = await buildCsr({ hash: 'SHA-1' }).then(
  () => true,
  () => false,
);

const ARCHIVED_SUBJECT =
  '2.5.4.5=8b1f9c4e-2d44-4a76-9c1b-2f1a3b4c5d6e, CN=DVS Acme Sub-CA, ' +
  'OU=DVS PKI Operations, O=Acme Ltd, C=GB';

const WRONG_COUNTRIES = ['UK', 'GB', 'US', 'GBR'].filter(
  (c) => c !== REQUIRED_COUNTRY,
);

function subjectWith(parts: { cn?: string; o?: string; c?: string }): string {
  const {
    cn = 'DVS Acme Sub-CA',
    o = 'Acme Ltd',
    c = REQUIRED_COUNTRY,
  } = parts;
  return `CN=${cn}, O=${o}, C=${c}`;
}

async function runOn(pem: string): Promise<ValidationReport> {
  return validateCsrText(pem);
}

function rulesOf(report: ValidationReport): RuleId[] {
  return report.violations.map((v) => v.rule);
}

function expectViolations(report: ValidationReport, rules: RuleId[]): void {
  const found = rulesOf(report);
  for (const rule of rules) {
    expect(found, `expected ${rule} in [${found.join(', ')}]`).toContain(rule);
  }
}

function statusOf(report: ValidationReport, rule: RuleId): string | undefined {
  return report.checks.find((c) => c.rule === rule)?.status;
}

function messageOf(report: ValidationReport, rule: RuleId): string {
  return report.violations.find((v) => v.rule === rule)?.message ?? '';
}

/** Re-encodes the outer SEQUENCE length with one superfluous leading byte. */
function withNonMinimalOuterLength(der: Uint8Array): Uint8Array {
  const lengthOctets = der[1]! & 0x7f;
  const length = der.subarray(2, 2 + lengthOctets);
  const body = der.subarray(2 + lengthOctets);
  return new Uint8Array([
    der[0]!,
    0x80 | (lengthOctets + 1),
    0x00,
    ...length,
    ...body,
  ]);
}

async function buildPaddedCsr(): Promise<string> {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const subject = subjectWith({ cn: 'A'.repeat(attempt) });
    const pem = await buildCsr({ subject });
    if (pem.includes('=')) return pem;
  }
  throw new Error('Could not build a CSR with base64 padding');
}

function dnStatuses(report: ValidationReport): Record<string, string> {
  return Object.fromEntries(
    (report.metadata?.subjectDn ?? []).map((a) => [a.name, a.status]),
  );
}

function expectSinglePemFailure(report: ValidationReport): void {
  expect(rulesOf(report)).toEqual(['FORMAT.PEM']);
  expect(report.metadata).toBeUndefined();
  for (const check of report.checks) {
    if (check.rule !== 'FORMAT.PEM') {
      expect(check.status, `${check.rule} should be skipped`).toBe('skipped');
    }
  }
}

describe('validate-csr — happy paths', () => {
  it('accepts a valid P-256 / SHA-256 CSR', async () => {
    const report = await runOn(await buildCsr());
    expect(report.passed, JSON.stringify(report.violations, null, 2)).toBe(
      true,
    );
  });

  it('requires the country the CA chain uses', () => {
    expect(REQUIRED_COUNTRY).toBe('GB');
  });

  it('accepts the reference DN with the literal country', async () => {
    const subject = 'CN=DVS, O=DVS.COM, C=GB';
    const report = await runOn(await buildCsr({ subject }));
    expect(report.passed, JSON.stringify(report.violations, null, 2)).toBe(
      true,
    );
  });

  it('returns subject DN metadata in CN, O, C order', async () => {
    const report = await runOn(await buildCsr());
    expect(report.metadata?.subjectDn).toEqual([
      {
        name: 'CN',
        oid: '2.5.4.3',
        value: 'DVS Acme Sub-CA',
        status: 'passed',
      },
      { name: 'O', oid: '2.5.4.10', value: 'Acme Ltd', status: 'passed' },
      { name: 'C', oid: '2.5.4.6', value: REQUIRED_COUNTRY, status: 'passed' },
    ]);
  });
});

describe('validate-csr — format & signature checks', () => {
  it('accepts a CRLF-terminated PEM', async () => {
    const pem = (await buildCsr()).replace(/\n/g, '\r\n');
    expect((await runOn(pem)).passed).toBe(true);
  });

  it('accepts ASCII whitespace around the PEM block', async () => {
    const pem = ` \t\r\n${await buildCsr()} \t\r\n`;
    expect((await runOn(pem)).passed).toBe(true);
  });

  it('rejects non-PEM input', async () => {
    expectSinglePemFailure(await runOn('not a pem file'));
  });

  it.each([
    { scenario: 'before', wrap: (pem: string) => `\u00a0${pem}` },
    { scenario: 'after', wrap: (pem: string) => `${pem}\u00a0` },
  ])(
    'rejects non-ASCII whitespace $scenario the PEM block',
    async ({ wrap }) => {
      expectSinglePemFailure(await runOn(wrap(await buildCsr())));
    },
  );

  it.each([
    { scenario: 'LF', eol: '\n' },
    { scenario: 'CRLF', eol: '\r\n' },
  ])('rejects a blank line inside a $scenario base64 body', async ({ eol }) => {
    const lines = (await buildCsr()).trimEnd().split('\n');
    lines.splice(2, 0, '');
    expectSinglePemFailure(await runOn(lines.join(eol) + eol));
  });

  it('rejects base64 with its padding removed', async () => {
    const pem = await buildPaddedCsr();
    const unpadded = pem.replace(/=+\n-----END/, '\n-----END');
    expect(unpadded).not.toContain('=');
    expectSinglePemFailure(await runOn(unpadded));
  });

  it('rejects two CSR blocks', async () => {
    const pem = await buildCsr();
    expectSinglePemFailure(await runOn(pem + pem));
  });

  it('rejects a different PEM block type', async () => {
    const pem = (await buildCsr()).replaceAll(
      'CERTIFICATE REQUEST',
      'CERTIFICATE',
    );
    expectSinglePemFailure(await runOn(pem));
  });

  it('rejects junk surrounding the PEM block', async () => {
    const pem = `junk before\n${await buildCsr()}junk after\n`;
    expectSinglePemFailure(await runOn(pem));
  });

  it('rejects garbled base64 inside PEM envelope', async () => {
    const pem =
      '-----BEGIN CERTIFICATE REQUEST-----\n!!!notbase64!!!\n-----END CERTIFICATE REQUEST-----\n';
    expectSinglePemFailure(await runOn(pem));
  });

  it('rejects PEM with malformed base64 padding in the middle', async () => {
    const pem =
      '-----BEGIN CERTIFICATE REQUEST-----\nABC=DEFG\n-----END CERTIFICATE REQUEST-----\n';
    const report = await runOn(pem);
    expectSinglePemFailure(report);
    expect(report.violations[0]!.message).toContain('not valid base64');
  });

  it('rejects parseable but signature-tampered CSR', async () => {
    const pem = await buildCsr({ tamperSignature: true });
    expectViolations(await runOn(pem), ['FORMAT.SIGNATURE']);
  });

  it('rejects valid PEM wrapping non-PKCS#10 DER content', async () => {
    const der = Buffer.from('this is not valid ASN.1 DER content at all');
    const report = await runOn(toPem(der));
    expectViolations(report, ['FORMAT.PKCS10']);
  });

  it('rejects a valid CSR with trailing bytes after the SEQUENCE', async () => {
    const der = derOf(await buildCsr());
    const padded = new Uint8Array([...der, 0x00, 0x00]);
    const report = await runOn(toPem(padded));
    expect(rulesOf(report)).toEqual(['FORMAT.PKCS10']);
    expect(messageOf(report, 'FORMAT.PKCS10')).toContain('strict-DER');
    expect(report.metadata).toBeUndefined();
  });

  it('rejects a non-canonical (BER long-form length) encoding', async () => {
    const der = derOf(await buildCsr());
    const report = await runOn(toPem(withNonMinimalOuterLength(der)));
    expect(rulesOf(report)).toEqual(['FORMAT.PKCS10']);
    expect(messageOf(report, 'FORMAT.PKCS10')).toContain('strict-DER');
  });
});

describe('validate-csr — crypto profile checks', () => {
  it('rejects RSA keys', async () => {
    const pem = await buildCsr({ algorithm: 'RSA' });
    expectViolations(await runOn(pem), ['KEY.TYPE_EC']);
  });

  it('rejects P-384 with SHA-384 (both curve and hash unsupported)', async () => {
    const pem = await buildCsr({ namedCurve: 'P-384', hash: 'SHA-384' });
    const report = await runOn(pem);
    expect([...rulesOf(report)].sort()).toEqual(['KEY.CURVE', 'KEY.HASH']);
    expect(statusOf(report, 'KEY.CURVE')).toBe('failed');
    expect(statusOf(report, 'KEY.HASH')).toBe('failed');
    expect(messageOf(report, 'KEY.CURVE')).toContain('P-384');
    expect(messageOf(report, 'KEY.HASH')).toContain('SHA-384');
  });

  it('rejects P-384 with SHA-256 (curve unsupported, hash acceptable)', async () => {
    const pem = await buildCsr({ namedCurve: 'P-384', hash: 'SHA-256' });
    const report = await runOn(pem);
    expect(rulesOf(report)).toEqual(['KEY.CURVE']);
    expect(statusOf(report, 'KEY.CURVE')).toBe('failed');
    expect(statusOf(report, 'KEY.HASH')).toBe('passed');
  });

  it('rejects P-256 with SHA-384 (curve acceptable, hash unsupported)', async () => {
    const pem = await buildCsr({ namedCurve: 'P-256', hash: 'SHA-384' });
    const report = await runOn(pem);
    expect(rulesOf(report)).toEqual(['KEY.HASH']);
    expect(statusOf(report, 'KEY.CURVE')).toBe('passed');
    expect(statusOf(report, 'KEY.HASH')).toBe('failed');
  });

  it('rejects P-521 with SHA-256 (pure curve rejection)', async () => {
    const pem = await buildCsr({ namedCurve: 'P-521', hash: 'SHA-256' });
    const report = await runOn(pem);
    expect(rulesOf(report)).toEqual(['KEY.CURVE']);
    expect(statusOf(report, 'KEY.CURVE')).toBe('failed');
    expect(statusOf(report, 'KEY.HASH')).toBe('passed');
  });

  it.skipIf(!sha1SigningSupported)(
    'rejects SHA-1 as an unsupported hash',
    async () => {
      const pem = await buildCsr({ namedCurve: 'P-256', hash: 'SHA-1' });
      const report = await runOn(pem);
      expect(rulesOf(report)).toEqual(['KEY.HASH']);
      expect(statusOf(report, 'KEY.CURVE')).toBe('passed');
      expect(statusOf(report, 'KEY.HASH')).toBe('failed');
      expect(messageOf(report, 'KEY.HASH')).toContain('SHA-1');
    },
  );
});

describe('validate-csr — Subject DN checks', () => {
  it('rejects the archived five-attribute subject', async () => {
    const report = await runOn(await buildCsr({ subject: ARCHIVED_SUBJECT }));
    expect(rulesOf(report)).toEqual(['DN.ATTRIBUTES']);
    const message = messageOf(report, 'DN.ATTRIBUTES');
    expect(message).toContain('exactly 3 attributes (CN, O, C)');
    expect(message).toContain('found 5');
    expect(message).toContain('2.5.4.5');
    expect(message).toContain('2.5.4.11');
  });

  it('skips DN value rules for the archived subject', async () => {
    const report = await runOn(await buildCsr({ subject: ARCHIVED_SUBJECT }));
    expect(statusOf(report, 'DN.ATTRIBUTES')).toBe('failed');
    expect(statusOf(report, 'DN.C')).toBe('skipped');
    expect(statusOf(report, 'DN.NONEMPTY')).toBe('skipped');
  });

  it('rejects a missing O', async () => {
    const subject = `CN=DVS Acme Sub-CA, C=${REQUIRED_COUNTRY}`;
    const report = await runOn(await buildCsr({ subject }));
    expect(rulesOf(report)).toEqual(['DN.ATTRIBUTES']);
    expect(messageOf(report, 'DN.ATTRIBUTES')).toContain('Missing: [O]');
  });

  it('rejects an extra OU attribute', async () => {
    const subject = `${subjectWith({})}, OU=DVS PKI Operations`;
    const report = await runOn(await buildCsr({ subject }));
    expect(rulesOf(report)).toEqual(['DN.ATTRIBUTES']);
    expect(messageOf(report, 'DN.ATTRIBUTES')).toContain(
      'Unexpected: [2.5.4.11]',
    );
  });

  it('rejects duplicate CN attributes', async () => {
    const subject = `CN=Duplicate, ${subjectWith({})}`;
    const report = await runOn(await buildCsr({ subject }));
    expect(rulesOf(report)).toEqual(['DN.ATTRIBUTES']);
    expect(messageOf(report, 'DN.ATTRIBUTES')).toContain('Duplicate: [CN]');
    expect(statusOf(report, 'DN.C')).toBe('skipped');
    expect(statusOf(report, 'DN.NONEMPTY')).toBe('skipped');
  });

  it.each(WRONG_COUNTRIES)(
    'rejects country code %s with DN.C only',
    async (country) => {
      const subject = subjectWith({ c: country });
      const report = await runOn(await buildCsr({ subject }));
      expect(rulesOf(report)).toEqual(['DN.C']);
      expect(messageOf(report, 'DN.C')).toBe(
        `Subject 'C' must be '${REQUIRED_COUNTRY}'; found '${country}'.`,
      );
      const c = report.metadata?.subjectDn.find((a) => a.name === 'C');
      expect(c?.status).toBe('failed');
    },
  );

  it('rejects a blank CN', async () => {
    const subject = subjectWith({ cn: '" "' });
    const report = await runOn(await buildCsr({ subject }));
    expect(rulesOf(report)).toEqual(['DN.NONEMPTY']);
    expect(messageOf(report, 'DN.NONEMPTY')).toContain("'CN'");
    expect(dnStatuses(report)).toEqual({
      CN: 'failed',
      O: 'passed',
      C: 'passed',
    });
  });

  it('rejects a blank O', async () => {
    const subject = subjectWith({ o: '" "' });
    const report = await runOn(await buildCsr({ subject }));
    expect(rulesOf(report)).toEqual(['DN.NONEMPTY']);
    expect(messageOf(report, 'DN.NONEMPTY')).toContain("'O'");
    expect(dnStatuses(report)).toEqual({
      CN: 'passed',
      O: 'failed',
      C: 'passed',
    });
  });
});

describe('validate-csr — Subject DN string encodings', () => {
  it.each(['utf8String', 'bmpString', 'ia5String'] as const)(
    'reads a CN encoded as %s',
    async (stringType) => {
      const pem = mutateCsr(await buildCsr(), (asn) => {
        const cn = asn.certificationRequestInfo.subject
          .flat()
          .find((atv) => atv.type === '2.5.4.3')!;
        cn.value = new AttributeValue({ [stringType]: 'DVS Acme Sub-CA' });
      });
      const report = await runOn(pem);
      expect(rulesOf(report)).toEqual(['FORMAT.SIGNATURE']);
      expect(statusOf(report, 'DN.NONEMPTY')).toBe('passed');
      expect(report.metadata?.subjectDn[0]).toMatchObject({
        name: 'CN',
        value: 'DVS Acme Sub-CA',
        status: 'passed',
      });
    },
  );
});

describe('validate-csr — extension prohibitions', () => {
  it('rejects basicConstraints extension', async () => {
    const ext = new x509.BasicConstraintsExtension(true, 0, true);
    const report = await runOn(await buildCsr({ extensions: [ext] }));
    expectViolations(report, ['EXT.NONE']);
    expect(messageOf(report, 'EXT.NONE')).toContain('basicConstraints');
  });

  it('rejects keyUsage extension', async () => {
    const ext = new x509.KeyUsagesExtension(
      x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
      true,
    );
    const report = await runOn(await buildCsr({ extensions: [ext] }));
    expectViolations(report, ['EXT.NONE']);
    expect(messageOf(report, 'EXT.NONE')).toContain('keyUsage');
  });

  it('rejects an untracked extension (subjectAltName)', async () => {
    const ext = new x509.SubjectAlternativeNameExtension([
      { type: 'dns', value: 'a.example' },
    ]);
    const report = await runOn(await buildCsr({ extensions: [ext] }));
    expect(rulesOf(report)).toEqual(['EXT.NONE']);
    expect(messageOf(report, 'EXT.NONE')).toContain('2.5.29.17');
    expect(report.metadata?.extensions).toContainEqual({
      name: '2.5.29.17',
      oid: '2.5.29.17',
      present: true,
    });
  });

  it('reports no extensions present in metadata for a valid CSR', async () => {
    const report = await runOn(await buildCsr());
    const extensions = report.metadata?.extensions ?? [];
    expect(extensions).toHaveLength(6);
    expect(extensions.every((e) => !e.present)).toBe(true);
  });

  it('flags only basicConstraints as present in metadata', async () => {
    const ext = new x509.BasicConstraintsExtension(true, 0, true);
    const report = await runOn(await buildCsr({ extensions: [ext] }));
    const present = report.metadata?.extensions
      .filter((e) => e.present)
      .map((e) => e.name);
    expect(present).toEqual(['basicConstraints']);
  });

  it('rejects extensions hidden in a second extensionRequest value', async () => {
    const ext = new x509.BasicConstraintsExtension(true, 0, true);
    const pem = mutateCsr(await buildCsr({ extensions: [ext] }), (asn) => {
      const empty = AsnConvert.serialize(new Extensions());
      asn.certificationRequestInfo.attributes[0]!.values.unshift(empty);
    });
    const report = await runOn(pem);
    expect(messageOf(report, 'EXT.NONE')).toContain('basicConstraints');
  });

  it('rejects extensions requested via msCertExtensions', async () => {
    const ext = new x509.BasicConstraintsExtension(true, 0, true);
    const pem = mutateCsr(await buildCsr({ extensions: [ext] }), (asn) => {
      asn.certificationRequestInfo.attributes[0]!.type =
        '1.3.6.1.4.1.311.2.1.14';
    });
    const report = await runOn(pem);
    expect(messageOf(report, 'EXT.NONE')).toContain('basicConstraints');
  });
});

describe('validate-csr — malformed CSR fields are reported, never thrown', () => {
  it('reports a malformed extensionRequest value as EXT.NONE', async () => {
    const pem = mutateCsr(await buildCsr(), (asn) => {
      asn.certificationRequestInfo.attributes.push(
        new Attribute({
          type: '1.2.840.113549.1.9.14',
          values: [new Uint8Array([0x02, 0x01, 0x05]).buffer],
        }),
      );
    });
    const report = await runOn(pem);
    expect(statusOf(report, 'EXT.NONE')).toBe('failed');
    expect(messageOf(report, 'EXT.NONE')).toContain('malformed');
  });

  it('reports an EC key without curve parameters as KEY.TYPE_EC', async () => {
    const pem = mutateCsr(await buildCsr(), (asn) => {
      asn.certificationRequestInfo.subjectPKInfo.algorithm.parameters =
        undefined;
    });
    const report = await runOn(pem);
    expect(statusOf(report, 'KEY.TYPE_EC')).toBe('failed');
    expect(messageOf(report, 'KEY.TYPE_EC')).toContain('could not be checked');
  });

  it('reports a signature that fails to decode as FORMAT.SIGNATURE', async () => {
    const pem = mutateCsr(await buildCsr(), (asn) => {
      asn.signature = new Uint8Array([0x02, 0x01, 0x01]).buffer;
    });
    const report = await runOn(pem);
    expect(rulesOf(report)).toEqual(['FORMAT.SIGNATURE']);
    expect(messageOf(report, 'FORMAT.SIGNATURE')).toContain('threw');
  });
});

describe('validate-csr — pipeline enforcement', () => {
  it('reports all violations from a multi-violation CSR', async () => {
    const report = await runOn(
      await buildCsr({
        subject: subjectWith({ c: WRONG_COUNTRIES[0] }),
        extensions: [new x509.BasicConstraintsExtension(true, 0, true)],
        namedCurve: 'P-256',
        hash: 'SHA-384',
      }),
    );
    expect(report.passed).toBe(false);
    expect([...rulesOf(report)].sort()).toEqual([
      'DN.C',
      'EXT.NONE',
      'KEY.HASH',
    ]);
  });

  it('each violation carries a non-empty message', async () => {
    const report = await runOn(await buildCsr({ algorithm: 'RSA' }));
    expect(report.violations.length).toBeGreaterThan(0);
    for (const v of report.violations) {
      expect(v.message.length).toBeGreaterThan(0);
    }
  });
});

describe('validate-csr — checks array and skipped state', () => {
  it('marks all 10 rules as passed for a valid CSR', async () => {
    const report = await runOn(await buildCsr());
    expect(report.checks.length).toBe(10);
    for (const check of report.checks) {
      expect(check.status, `${check.rule} should be passed`).toBe('passed');
      expect(check.section).toBeTruthy();
    }
  });

  it('marks curve and hash as skipped when key type is RSA', async () => {
    const report = await runOn(await buildCsr({ algorithm: 'RSA' }));
    expect(statusOf(report, 'KEY.TYPE_EC')).toBe('failed');
    expect(statusOf(report, 'KEY.CURVE')).toBe('skipped');
    expect(statusOf(report, 'KEY.HASH')).toBe('skipped');
  });
});
