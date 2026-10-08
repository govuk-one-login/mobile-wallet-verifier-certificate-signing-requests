# mobile-wallet-verifier-certificate-signing-requests

Infrastructure and functions for storing certificate signing requests and triggering of issuing certificates for wallet credential verifiers.

## Issue / Revoke Subordinate CA Certificates

An interactive CLI script for issuing and revoking subordinate CA certificates via ACM Private CA. All CSR reads and certificate uploads happen **in-memory via S3** — no files are read from or written to the local filesystem.

### Prerequisites

- **Node.js 22** (see `.nvmrc`)
- **AWS CLI** — logged into the target account with an approved SSO role:
  - `AWSReservedSSO_ApprovedMobWalletCAIssueRevoke_*`
  - `AWSReservedSSO_AdministratorAccessPermission_*`
- **Deployed stacks** — the CSR stack (`verifier-csr`) and CA stack (`dvs-ca`) must be deployed to the target environment. The script assumes the `L3IssueRevokeOperatorRole` from the CSR stack for scoped-down S3/KMS permissions.
- CSR must already be validated and present in the `csr-validated` S3 bucket

### Usage

```bash
npm install
npm run issue-revoke-ca
```

The script will prompt you to:

1. **Select action** — `issue` or `revoke`
2. **Authenticate** — verifies your SSO role
3. **Select environment** — `dev`, `build`, `integration`, or `production`
4. **Configure stack names** (dev only) — CA and CSR CloudFormation stack names
5. **Assume operator role** — assumes `L3IssueRevokeOperatorRole` for S3/KMS access

#### Issuing a certificate

- Lists validated CSR `.pem` files from the S3 bucket
- You select a CSR and provide an expiry date (`YYYY-MM-DD`)
- The CSR is downloaded into memory, validated, and signed via ACM PCA
- Issued `cert.pem` and `chain.pem` are uploaded directly to the output S3 bucket
- Pre-signed download URLs (valid 5 days) are displayed

#### Revoking a certificate

- You provide the certificate serial number (colon-hex format, e.g. `aa:bb:cc:dd`)
- You select a revocation reason
- The certificate is revoked via ACM PCA

### Data flow

```
┌──────────────────┐     in-memory      ┌────────────┐     in-memory      ┌──────────────────┐
│  csr-validated    │ ──── download ───→ │  validate  │ ──── upload ────→  │  issued-certs    │
│  S3 bucket        │                    │  + sign    │                    │  S3 bucket       │
└──────────────────┘                     └────────────┘                    └──────────────────┘
```

No files are written to the local filesystem at any point.

### Stack resolution

The script resolves configuration from two CloudFormation stacks:

| Stack     | Default name   | Outputs used                                    |
| --------- | -------------- | ----------------------------------------------- |
| CA stack  | `dvs-ca`       | `DVSIntermediateCAArn`, `IssuedCertsBucketName` |
| CSR stack | `verifier-csr` | `CsrValidatedBucketName`                        |

In `dev`, both stack names can be overridden interactively.

## Commands

| Operation                    | Command                                |
| ---------------------------- | -------------------------------------- |
| Issue / revoke certificate   | `npm run issue-revoke-ca`              |
| Run tests                    | `npm test`                             |
| Run all tests (incl. system) | `npm run test:all`                     |
| Run script tests only        | `npx vitest run --project script-unit` |
| Lint                         | `npm run lint`                         |
| Format check                 | `npm run format:check`                 |

## Testing

Tests use [vitest](https://vitest.dev/) with [aws-sdk-client-mock](https://github.com/m-radzikowski/aws-sdk-client-mock) for AWS SDK mocking.

```bash
npm test              # infra + script-unit tests
npm run test:all      # all test projects
```

### Script unit tests

Located in `scripts/unit/`, covering:

- **s3-core** — in-memory S3 download, upload, verify, list, presign
- **config** — two-stack CloudFormation output resolution
- **role-guard** — IAM role assertion
- **revoke** — serial format validation, ACM PCA revocation
- **issue** — certificate issuance orchestration (mocked ACM PCA + S3)
- **validate** — CSR validation pipeline (PEM, PKCS#10, crypto, DN, extensions)
