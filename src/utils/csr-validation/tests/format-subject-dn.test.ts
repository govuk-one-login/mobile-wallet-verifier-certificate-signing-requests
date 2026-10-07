import { describe, it, expect } from 'vitest';
import { formatSubjectDn } from '../format-subject-dn.ts';
import { validateCsrText } from '../validate-csr.ts';
import type { DnAttribute } from '../types.ts';
import { buildCsr } from './utils/builders.ts';

const OIDS: Record<string, string> = {
  CN: '2.5.4.3',
  O: '2.5.4.10',
  C: '2.5.4.6',
};

function attrs(values: { cn: string; o: string; c: string }): DnAttribute[] {
  return [
    { name: 'CN', oid: OIDS.CN!, value: values.cn, status: 'passed' },
    { name: 'O', oid: OIDS.O!, value: values.o, status: 'passed' },
    { name: 'C', oid: OIDS.C!, value: values.c, status: 'passed' },
  ];
}

function formatCn(cn: string): string {
  return formatSubjectDn(attrs({ cn, o: 'Acme Ltd', c: 'GB' }));
}

describe('formatSubjectDn', () => {
  it('joins the attributes as CN=…,O=…,C=… without spaces after commas', () => {
    const dn = formatSubjectDn(attrs({ cn: 'DVS', o: 'DVS.COM', c: 'GB' }));

    expect(dn).toBe('CN=DVS,O=DVS.COM,C=GB');
  });

  it('keeps inner spaces and non-ASCII characters unescaped', () => {
    expect(formatCn('DVS Acme Sub-CA é')).toBe(
      'CN=DVS Acme Sub-CA é,O=Acme Ltd,C=GB',
    );
  });

  it.each([
    { char: ',', escaped: String.raw`\,` },
    { char: '+', escaped: String.raw`\+` },
    { char: '"', escaped: String.raw`\"` },
    { char: '\\', escaped: String.raw`\\` },
    { char: '<', escaped: String.raw`\<` },
    { char: '>', escaped: String.raw`\>` },
    { char: ';', escaped: String.raw`\;` },
  ])('escapes $char wherever it appears', ({ char, escaped }) => {
    expect(formatCn(`a${char}b${char}`)).toBe(
      `CN=a${escaped}b${escaped},O=Acme Ltd,C=GB`,
    );
  });

  it('escapes a leading space and a leading #', () => {
    expect(formatCn(' lead')).toBe(String.raw`CN=\ lead,O=Acme Ltd,C=GB`);
    expect(formatCn('#lead')).toBe(String.raw`CN=\#lead,O=Acme Ltd,C=GB`);
  });

  it('leaves # and = unescaped away from the start', () => {
    expect(formatCn('a#b=c')).toBe('CN=a#b=c,O=Acme Ltd,C=GB');
  });

  it('escapes a trailing space', () => {
    expect(formatCn('trail ')).toBe(String.raw`CN=trail\ ,O=Acme Ltd,C=GB`);
  });

  it('escapes a trailing space that follows a backslash', () => {
    expect(formatCn('a\\ ')).toBe(String.raw`CN=a\\\ ,O=Acme Ltd,C=GB`);
  });

  it('escapes a value that is a single space exactly once', () => {
    expect(formatCn(' ')).toBe(String.raw`CN=\ ,O=Acme Ltd,C=GB`);
  });

  it('escapes a NUL character as \\00', () => {
    expect(formatCn('a\0b')).toBe(String.raw`CN=a\00b,O=Acme Ltd,C=GB`);
  });

  it('renders an empty value as an empty string', () => {
    expect(formatCn('')).toBe('CN=,O=Acme Ltd,C=GB');
  });

  it('prevents a value from forging another attribute', () => {
    const dn = formatSubjectDn(
      attrs({ cn: 'Evil,O=Trusted Org', o: 'Acme Ltd', c: 'GB' }),
    );

    expect(dn).toBe(String.raw`CN=Evil\,O=Trusted Org,O=Acme Ltd,C=GB`);
  });

  it('formats the subject parsed from a real CSR in C, O, OU, CN, serialNumber order', async () => {
    const serial = '8b1f9c4e-2d44-4a76-9c1b-2f1a3b4c5d6e';
    const pem = await buildCsr({
      subject: `2.5.4.5=${serial}, CN=DVS, OU=DVS PKI Operations, O=DVS.COM, C=GB`,
    });
    const report = await validateCsrText(pem);

    expect(formatSubjectDn(report.metadata!.subjectDn)).toBe(
      `C=GB,O=DVS.COM,OU=DVS PKI Operations,CN=DVS,serialNumber=${serial}`,
    );
  });
});
