/**
 * Certificate issuance via ACM Private CA.
 *
 * All I/O is in-memory:
 *   - CSR PEM is received as a string (fetched from S3 by the caller).
 *   - Issued cert + chain are uploaded to S3 via s3-core helpers.
 *   - No files are read from or written to the local filesystem.
 */
import { webcrypto } from 'node:crypto';
import { parse } from 'node:path';
import * as x509 from '@peculiar/x509';
import { AsnConvert } from '@peculiar/asn1-schema';
import {
  GeneralSubtree,
  GeneralSubtrees,
  NameConstraints as AsnNameConstraints,
  GeneralName,
  Name as AsnName,
} from '@peculiar/asn1-x509';
import {
  ACMPCAClient,
  IssueCertificateCommand,
  GetCertificateCommand,
  waitUntilCertificateIssued,
} from '@aws-sdk/client-acm-pca';
import { validateCsrText } from '../../../src/utils/csr-validation/validate-csr.js';
import type { ValidationReport } from '../../../src/utils/csr-validation/types.js';
import { getIssuedCertsBucket } from './config.js';
import {
  createS3Client,
  upload,
  verifyPresent,
  presignGetUrl,
} from './s3-core.js';
import {
  AWS_REGION,
  S3_ISSUED_PREFIX,
  SUBORDINATE_CA_TEMPLATE_ARN,
} from './constants.js';

x509.cryptoProvider.set(webcrypto as Crypto);

// Public types

export interface IssueResult {
  certificateArn: string;
  certificateSerial: string;
  certPresignedUrl: string;
  chainPresignedUrl: string;
}

// Helpers

export function toGeneralizedTime(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

interface SubjectFields {
  organization: string;
  organizationalUnit: string;
  commonName: string;
  serialNumber: string;
}

function extractSubjectFields(csrPem: string): SubjectFields {
  const req = new x509.Pkcs10CertificateRequest(csrPem);
  const name = req.subjectName;
  const org = name.getField('O');
  const ou = name.getField('OU');
  const cn = name.getField('CN');
  const serial = name.getField('2.5.4.5'); // serialNumber OID
  if (!org?.length)
    throw new Error('CSR is missing Organization (O) in Subject DN');
  if (!ou?.length)
    throw new Error('CSR is missing OrganizationalUnit (OU) in Subject DN');
  if (!cn?.length)
    throw new Error('CSR is missing CommonName (CN) in Subject DN');
  if (!serial?.length)
    throw new Error('CSR is missing serialNumber in Subject DN');
  return {
    organization: org[0]!,
    organizationalUnit: ou[0]!,
    commonName: cn[0]!,
    serialNumber: serial[0]!,
  };
}

function buildNameConstraintsB64(org: string): string {
  const name = new x509.Name(`C=GB, O=${org}`);
  const rdnSeq = AsnConvert.parse(name.toArrayBuffer(), AsnName);
  const subtree = new GeneralSubtree();
  subtree.base = new GeneralName({ directoryName: rdnSeq });
  subtree.minimum = 0;
  const nc = new AsnNameConstraints();
  nc.permittedSubtrees = new GeneralSubtrees([subtree]);
  const der = AsnConvert.serialize(nc);
  return Buffer.from(der).toString('base64');
}

// Main issuance function

/**
 * Issues a subordinate CA certificate.
 *
 * @param caArn       - ARN of the ACM PCA Certificate Authority
 * @param csrPem      - PEM-encoded CSR (in-memory string, fetched from S3)
 * @param csrFileName - Original filename, used to derive the S3 key prefix
 * @param expiryDate  - Certificate expiry date
 */
export async function issueCertificate(
  caArn: string,
  csrPem: string,
  csrFileName: string,
  expiryDate: Date,
): Promise<IssueResult> {
  // 1. Validate CSR in-memory
  const report = await validateCsrText(csrPem);
  if (!report.passed) {
    printReport(report, csrFileName);
    throw new Error('CSR failed validation — issuance aborted.');
  }

  // 2. Extract subject fields
  const subject = extractSubjectFields(csrPem);

  // 3. Issue certificate via ACM PCA
  const pca = new ACMPCAClient({ region: AWS_REGION });

  const { CertificateArn } = await pca.send(
    new IssueCertificateCommand({
      CertificateAuthorityArn: caArn,
      Csr: Buffer.from(csrPem),
      SigningAlgorithm: 'SHA256WITHECDSA',
      Validity: {
        Value: Number(toGeneralizedTime(expiryDate)),
        Type: 'END_DATE',
      },
      TemplateArn: SUBORDINATE_CA_TEMPLATE_ARN,
      ApiPassthrough: {
        Subject: {
          Country: 'GB',
          Organization: subject.organization,
          OrganizationalUnit: subject.organizationalUnit,
          CommonName: subject.commonName,
          SerialNumber: subject.serialNumber,
        },
        Extensions: {
          CustomExtensions: [
            {
              ObjectIdentifier: '2.5.29.30', // NameConstraints
              Critical: true,
              Value: buildNameConstraintsB64(subject.organization),
            },
          ],
        },
      },
    }),
  );

  if (!CertificateArn) throw new Error('IssueCertificate returned no ARN');

  // 4. Wait for issuance
  await waitUntilCertificateIssued(
    { client: pca, maxWaitTime: 120 },
    { CertificateAuthorityArn: caArn, CertificateArn },
  );

  // 5. Fetch issued cert + chain (in-memory)
  const { Certificate, CertificateChain } = await pca.send(
    new GetCertificateCommand({
      CertificateAuthorityArn: caArn,
      CertificateArn,
    }),
  );

  if (!Certificate) throw new Error('GetCertificate returned empty body');
  if (!CertificateChain) throw new Error('GetCertificate returned no chain');

  // 6. Extract serial number
  const issuedCert = new x509.X509Certificate(Certificate);
  const rawSerial = issuedCert.serialNumber;
  const certificateSerial = rawSerial
    .toLowerCase()
    .replace(/(.{2})(?=.)/g, '$1:');

  // 7. Upload to S3 (in-memory → S3, no disk)
  const baseName = parse(csrFileName).name;
  const certKey = `${S3_ISSUED_PREFIX}/${baseName}/cert.pem`;
  const chainKey = `${S3_ISSUED_PREFIX}/${baseName}/chain.pem`;
  const bucket = await getIssuedCertsBucket();
  const s3 = createS3Client();

  await Promise.all([
    upload(s3, bucket, certKey, Certificate),
    upload(s3, bucket, chainKey, CertificateChain),
  ]);

  // 8. Verify uploads
  await Promise.all([
    verifyPresent(s3, bucket, certKey),
    verifyPresent(s3, bucket, chainKey),
  ]);

  // 9. Generate pre-signed URLs
  const [certPresignedUrl, chainPresignedUrl] = await Promise.all([
    presignGetUrl(s3, bucket, certKey),
    presignGetUrl(s3, bucket, chainKey),
  ]);

  return {
    certificateArn: CertificateArn,
    certificateSerial,
    certPresignedUrl,
    chainPresignedUrl,
  };
}

// Report printing

function printReport(report: ValidationReport, label: string): void {
  console.log(`✗ ${label}: ${report.violations.length} violation(s)`);
  for (const v of report.violations) {
    console.log(`  [${v.rule}] ${v.message}`);
  }
}
