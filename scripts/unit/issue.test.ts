import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  ACMPCAClient,
  IssueCertificateCommand,
  GetCertificateCommand,
} from '@aws-sdk/client-acm-pca';
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  issueCertificate,
  toGeneralizedTime,
} from '../lib/issue-revoke/issue.js';
import { validateCsrText } from '../../src/utils/csr-validation/validate-csr.js';
import { getIssuedCertsBucket } from '../lib/issue-revoke/config.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { VALID_CSR_PEM } from './fixtures.js';

// Mocks

vi.mock('../../src/utils/csr-validation/validate-csr.js', () => ({
  validateCsrText: vi.fn(),
}));

vi.mock('../lib/issue-revoke/config.js', () => ({
  getIssuedCertsBucket: vi.fn(),
  getOperatorCredentials: vi.fn().mockReturnValue({
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    sessionToken: 'FwoGZXIvYXdzEBYaDH',
  }),
}));

vi.mock('@aws-sdk/client-acm-pca', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@aws-sdk/client-acm-pca')>();
  return {
    ...actual,
    waitUntilCertificateIssued: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('@peculiar/x509', () => {
  const mockCryptoProvider = { set: vi.fn() };

  class MockPkcs10CertificateRequest {
    subjectName = {
      getField: (oid: string) => {
        const fields: Record<string, string[]> = {
          O: ['Great DVS'],
          OU: ['Great DVS CA'],
          CN: ['Great DVS Verifier Sub-CA'],
          '2.5.4.5': ['550e8400-e29b-41d4-a716-446655440000'],
        };
        return fields[oid] ?? [];
      },
    };
  }

  class MockX509Certificate {
    serialNumber = 'aabbccdd11223344';
  }

  class MockName {
    toArrayBuffer() {
      return new ArrayBuffer(0);
    }
  }

  return {
    cryptoProvider: mockCryptoProvider,
    Pkcs10CertificateRequest: MockPkcs10CertificateRequest,
    X509Certificate: MockX509Certificate,
    Name: MockName,
  };
});

vi.mock('@peculiar/asn1-schema', () => ({
  AsnConvert: {
    parse: vi.fn().mockReturnValue({}),
    serialize: vi.fn().mockReturnValue(new ArrayBuffer(8)),
  },
}));

vi.mock('@peculiar/asn1-x509', () => {
  class MockGeneralSubtree {
    base = null;
    minimum = 0;
  }
  class MockGeneralSubtrees extends Array {}
  class MockNameConstraints {
    permittedSubtrees = null;
  }
  class MockGeneralName {
    directoryName = null;
  }
  class MockName {
    value = null;
  }

  return {
    GeneralSubtree: MockGeneralSubtree,
    GeneralSubtrees: MockGeneralSubtrees,
    NameConstraints: MockNameConstraints,
    GeneralName: MockGeneralName,
    Name: MockName,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi
    .fn()
    .mockResolvedValue('https://s3.presigned.example.com/fake'),
}));

// SDK mocks

const pcaMock = mockClient(ACMPCAClient);
const s3Mock = mockClient(S3Client);

// Fixtures

const CA_ARN =
  'arn:aws:acm-pca:eu-west-2:123456789012:certificate-authority/abc';
const CSR_FILENAME = 'test-csr.pem';
const EXPIRY_DATE = new Date('2027-12-31T23:59:59Z');
const ISSUED_CERT_ARN =
  'arn:aws:acm-pca:eu-west-2:123456789012:' +
  'certificate-authority/abc/certificate/def';
const BUCKET = 'issued-certs-bucket';

const FAKE_CERT_PEM =
  '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----';
const FAKE_CHAIN_PEM =
  '-----BEGIN CERTIFICATE-----\nFAKECHAIN\n-----END CERTIFICATE-----';

// Helpers

function setupHappyPath(): void {
  vi.mocked(validateCsrText).mockResolvedValue({
    passed: true,
    violations: [],
    checks: [],
  });
  vi.mocked(getIssuedCertsBucket).mockResolvedValue(BUCKET);

  pcaMock
    .on(IssueCertificateCommand)
    .resolves({ CertificateArn: ISSUED_CERT_ARN });

  pcaMock.on(GetCertificateCommand).resolves({
    Certificate: FAKE_CERT_PEM,
    CertificateChain: FAKE_CHAIN_PEM,
  });

  s3Mock.on(PutObjectCommand).resolves({});
  s3Mock.on(HeadObjectCommand).resolves({});

  vi.mocked(getSignedUrl)
    .mockResolvedValueOnce('https://s3.presigned.example.com/cert.pem')
    .mockResolvedValueOnce('https://s3.presigned.example.com/chain.pem');
}

// Setup

beforeEach(() => {
  pcaMock.reset();
  s3Mock.reset();
  vi.mocked(validateCsrText).mockReset();
  vi.mocked(getIssuedCertsBucket).mockReset();
  vi.mocked(getSignedUrl).mockReset();
});

// toGeneralizedTime

describe('toGeneralizedTime', () => {
  it('converts a date to generalized time format', () => {
    const date = new Date('2027-12-31T23:59:59Z');
    expect(toGeneralizedTime(date)).toBe('20271231235959');
  });

  it('pads single-digit months and days', () => {
    const date = new Date('2026-01-05T08:03:02Z');
    expect(toGeneralizedTime(date)).toBe('20260105080302');
  });

  it('handles midnight correctly', () => {
    const date = new Date('2026-06-15T00:00:00Z');
    expect(toGeneralizedTime(date)).toBe('20260615000000');
  });
});

// issueCertificate

describe('issueCertificate', () => {
  it('throws when CSR fails validation', async () => {
    vi.mocked(validateCsrText).mockResolvedValue({
      passed: false,
      violations: [],
      checks: [],
    });

    await expect(
      issueCertificate(CA_ARN, 'not-a-valid-pem', CSR_FILENAME, EXPIRY_DATE),
    ).rejects.toThrow(/CSR failed validation/);

    expect(pcaMock.commandCalls(IssueCertificateCommand)).toHaveLength(0);
  });

  it('calls IssueCertificateCommand with correct params', async () => {
    setupHappyPath();

    await issueCertificate(CA_ARN, VALID_CSR_PEM, CSR_FILENAME, EXPIRY_DATE);

    const calls = pcaMock.commandCalls(IssueCertificateCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0]!.args[0].input;
    expect(input.CertificateAuthorityArn).toBe(CA_ARN);
    expect(input.SigningAlgorithm).toBe('SHA256WITHECDSA');
    expect(input.Validity).toEqual({
      Value: Number(toGeneralizedTime(EXPIRY_DATE)),
      Type: 'END_DATE',
    });
    expect(input.TemplateArn).toBe(
      'arn:aws:acm-pca:::template/' +
        'SubordinateCACertificate_PathLen0_APIPassthrough/V1',
    );
    expect(input.ApiPassthrough?.Subject).toEqual({
      Country: 'GB',
      Organization: 'Great DVS',
      OrganizationalUnit: 'Great DVS CA',
      CommonName: 'Great DVS Verifier Sub-CA',
      SerialNumber: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('uploads cert and chain to S3 with correct keys', async () => {
    setupHappyPath();

    await issueCertificate(CA_ARN, VALID_CSR_PEM, CSR_FILENAME, EXPIRY_DATE);

    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    expect(putCalls).toHaveLength(2);

    const keys = putCalls
      .map((c) => c.args[0].input.Key)
      .sort((a, b) => (a ?? '').localeCompare(b ?? ''));
    expect(keys).toEqual([
      'issued/test-csr/cert.pem',
      'issued/test-csr/chain.pem',
    ]);

    const certUpload = putCalls.find(
      (c) => c.args[0].input.Key === 'issued/test-csr/cert.pem',
    );
    expect(certUpload!.args[0].input.Body).toBe(FAKE_CERT_PEM);
    expect(certUpload!.args[0].input.Bucket).toBe(BUCKET);

    const chainUpload = putCalls.find(
      (c) => c.args[0].input.Key === 'issued/test-csr/chain.pem',
    );
    expect(chainUpload!.args[0].input.Body).toBe(FAKE_CHAIN_PEM);
  });

  it('returns certificateArn, serial, and pre-signed URLs', async () => {
    setupHappyPath();

    const result = await issueCertificate(
      CA_ARN,
      VALID_CSR_PEM,
      CSR_FILENAME,
      EXPIRY_DATE,
    );

    expect(result.certificateArn).toBe(ISSUED_CERT_ARN);
    expect(result.certificateSerial).toBe('aa:bb:cc:dd:11:22:33:44');
    expect(result.certPresignedUrl).toBe(
      'https://s3.presigned.example.com/cert.pem',
    );
    expect(result.chainPresignedUrl).toBe(
      'https://s3.presigned.example.com/chain.pem',
    );
  });
});
