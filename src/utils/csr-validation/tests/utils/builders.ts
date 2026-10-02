import * as x509 from '@peculiar/x509';
import { AsnConvert } from '@peculiar/asn1-schema';
import { CertificationRequest } from '@peculiar/asn1-csr';
import { REQUIRED_COUNTRY } from '../../dn-checks.ts';
import { decodePem } from '../../pem.ts';

export interface CsrOptions {
  algorithm?: 'ECDSA' | 'RSA';
  namedCurve?: 'P-256' | 'P-384' | 'P-521';
  hash?: 'SHA-256' | 'SHA-384' | 'SHA-1';
  subject?: string;
  extensions?: x509.Extension[];
  tamperSignature?: boolean;
}

export async function buildCsr(options: CsrOptions = {}): Promise<string> {
  const {
    algorithm = 'ECDSA',
    namedCurve = 'P-256',
    hash = 'SHA-256',
    subject = defaultSubject(),
    extensions = [],
    tamperSignature = false,
  } = options;

  const keys = await generateKeys(algorithm, namedCurve, hash);
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: subject,
    keys,
    signingAlgorithm: signingAlgorithmFor(algorithm, hash),
    extensions,
  });

  if (tamperSignature) {
    return tamper(csr);
  }
  return csr.toString('pem');
}

export function defaultSubject(): string {
  return `CN=DVS Acme Sub-CA, O=Acme Ltd, C=${REQUIRED_COUNTRY}`;
}

async function generateKeys(
  algorithm: string,
  namedCurve: string,
  hash: string,
): Promise<CryptoKeyPair> {
  if (algorithm === 'RSA') {
    return crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash,
      },
      true,
      ['sign', 'verify'],
    ) as Promise<CryptoKeyPair>;
  }
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve }, true, [
    'sign',
    'verify',
  ]) as Promise<CryptoKeyPair>;
}

function signingAlgorithmFor(
  algorithm: string,
  hash: string,
): EcdsaParams | Algorithm {
  if (algorithm === 'RSA') {
    return { name: 'RSASSA-PKCS1-v1_5' };
  }
  return { name: 'ECDSA', hash: { name: hash } } as EcdsaParams;
}

function tamper(csr: x509.Pkcs10CertificateRequest): string {
  const der = new Uint8Array(csr.rawData);
  der[der.length - 1] = der[der.length - 1]! ^ 0xff;
  return toPem(der);
}

export function toPem(der: Uint8Array): string {
  const b64 = Buffer.from(der).toString('base64');
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN CERTIFICATE REQUEST-----\n${lines}\n-----END CERTIFICATE REQUEST-----\n`;
}

export function mutateCsr(
  pem: string,
  mutate: (asn: CertificationRequest) => void,
): string {
  const der = new Uint8Array(x509.PemConverter.decodeFirst(pem));
  const asn = AsnConvert.parse(der, CertificationRequest);
  mutate(asn);
  return toPem(new Uint8Array(AsnConvert.serialize(asn)));
}

export function derOf(pem: string): Uint8Array {
  const result = decodePem(pem);
  if (result.isError) throw new Error(result.value);
  return result.value;
}
