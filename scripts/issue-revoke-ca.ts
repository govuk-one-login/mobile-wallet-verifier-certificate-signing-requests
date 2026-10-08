#!/usr/bin/env tsx
/**
 * Interactive CLI for issuing and revoking subordinate CA certificates.
 *
 * All CSR reads and certificate uploads happen in-memory via S3 — no
 * files are read from or written to the local filesystem.
 */
import 'reflect-metadata';
import { styleText } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { assertRole } from './lib/issue-revoke/role-guard.js';
import { issueCertificate } from './lib/issue-revoke/issue.js';
import {
  getCaArn,
  getCsrValidatedBucket,
  setCaStackName,
  setCsrStackName,
  assumeOperatorRole,
} from './lib/issue-revoke/config.js';
import { revokeCertificate, VALID_REASONS } from './lib/issue-revoke/revoke.js';
import {
  ENVIRONMENTS,
  DEFAULT_CA_STACK_NAME,
  DATE_RE,
} from './lib/issue-revoke/constants.js';
import { createS3Client, download } from './lib/issue-revoke/s3-core.js';

// Utilities

function abort(msg: string): never {
  console.error(styleText('red', msg));
  process.exit(1);
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      `${styleText('bold', message)} ${styleText('dim', '[yes/no]:')} `,
    );
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

function pickIndex(choice: string, max: number): number {
  const idx = Number(choice) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= max) abort('Invalid selection.');
  return idx;
}

// Issue flow

async function handleIssue(
  prompt: ReturnType<typeof createInterface>,
  caArn: string,
): Promise<void> {
  // 1. Resolve the validated CSR bucket
  const bucket = await getCsrValidatedBucket();
  const s3 = createS3Client();

  // 2. Prompt for the CSR PEM filename
  const csrFileName = (
    await prompt.question(
      styleText('bold', `CSR pem filename in s3://${bucket}/validated/: `),
    )
  ).trim();
  if (!csrFileName) abort('CSR filename is required.');
  if (!csrFileName.endsWith('.pem')) abort('CSR filename must end with .pem');

  const csrKey = `validated/${csrFileName}`;

  // 3. Collect expiry date
  const expiryInput = (
    await prompt.question(styleText('bold', 'Expiry date (YYYY-MM-DD): '))
  ).trim();
  if (!DATE_RE.test(expiryInput)) abort('Invalid date format. Use YYYY-MM-DD.');
  const expiryDate = new Date(`${expiryInput}T23:59:59Z`);
  if (Number.isNaN(expiryDate.getTime())) abort('Invalid date.');
  if (expiryDate.getTime() <= Date.now())
    abort('Expiry date must be in the future.');

  prompt.close();

  // 4. Confirm
  console.log(
    styleText(['bold', 'yellow'], '\nAction: ISSUE subordinate CA certificate'),
  );
  const csrUri = `s3://${bucket}/${csrKey}`;
  console.log(`  CSR:      ${styleText('cyan', csrUri)}`);
  console.log(`  CA ARN:   ${styleText('dim', caArn)}`);
  console.log(`  Expiry:   ${styleText('cyan', expiryInput)}`);

  if (!(await confirm('\nProceed with issuance?'))) abort('Aborted.');

  // 5. Download CSR from S3 into memory
  console.log(styleText('dim', '\nDownloading CSR from S3 …'));
  const csrPem = await download(s3, bucket, csrKey);

  // 6. Issue certificate (in-memory: validate → sign → upload)
  const result = await issueCertificate(caArn, csrPem, csrFileName, expiryDate);

  console.log(
    styleText('green', '\n✓ Certificate issued: ') + result.certificateArn,
  );
  console.log(
    styleText('green', '✓ Certificate serial (colon-hex): ') +
      styleText('cyan', result.certificateSerial),
  );
  console.log(
    styleText('green', '✓ Certificate URL (5 days): ') +
      styleText('underline', result.certPresignedUrl),
  );
  console.log(
    styleText('green', '✓ Chain URL (5 days):       ') +
      styleText('underline', result.chainPresignedUrl),
  );
  console.log(
    styleText(
      ['bold', 'yellow'],
      '\n⚠ Please update SNOW ticket with Certificate URL, ' +
        'Chain URL and Serial Number above.',
    ),
  );
}

// Revoke flow

async function handleRevoke(
  prompt: ReturnType<typeof createInterface>,
  caArn: string,
): Promise<void> {
  const certSerial = (
    await prompt.question(
      styleText(
        'bold',
        '\nCertificate serial (colon-hex, e.g. aa:bb:cc:dd:...): ',
      ),
    )
  ).replace(/\s/g, '');
  if (!certSerial) abort('Certificate serial is required.');

  console.log(styleText('bold', '\nSelect revocation reason:'));
  VALID_REASONS.forEach((r, i) =>
    console.log(`  ${styleText('cyan', String(i + 1))}. ${r}`),
  );
  const reasonIdx = pickIndex(
    await prompt.question(styleText('bold', '\nEnter number: ')),
    VALID_REASONS.length,
  );
  const reason = VALID_REASONS[reasonIdx]!;

  prompt.close();

  console.log(styleText(['bold', 'red'], '\nAction: REVOKE certificate'));
  console.log(`  Serial: ${styleText('cyan', certSerial)}`);
  console.log(`  CA ARN: ${styleText('dim', caArn)}`);
  console.log(`  Reason: ${styleText('red', reason)}`);

  if (!(await confirm('\nProceed with revocation? This is IRREVERSIBLE.')))
    abort('Aborted.');

  await revokeCertificate(caArn, certSerial, reason);
  console.log(
    styleText(
      'green',
      `\n✓ The certificate (${certSerial}) has now been revoked, ` +
        'it can take up to 7 days for CRL endpoint to reflect this ' +
        'but is usually sooner.',
    ),
  );
  console.log(
    styleText(['bold', 'yellow'], '\n⚠ Please update SNOW ticket accordingly.'),
  );
}

// Main

async function main() {
  console.log(
    styleText(
      'yellow',
      '\n⚠ Please ensure you are already logged into the ' +
        'appropriate AWS account via AWS CLI.\n',
    ),
  );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Action selection
  console.log(styleText('bold', '\nSelect action:'));
  console.log(`  ${styleText('cyan', '1')}. issue`);
  console.log(`  ${styleText('cyan', '2')}. revoke`);
  const command = ['issue', 'revoke'][
    pickIndex(await prompt.question(styleText('bold', '\nEnter number: ')), 2)
  ]!;

  // Role assertion
  const identity = await assertRole();
  console.log(
    styleText('green', '✓ Authenticated as ') + styleText('dim', identity),
  );

  // Environment selection
  console.log(styleText('bold', '\nSelect environment:'));
  ENVIRONMENTS.forEach((e, i) =>
    console.log(`  ${styleText('cyan', String(i + 1))}. ${e}`),
  );
  const envIdx = pickIndex(
    await prompt.question(styleText('bold', '\nEnter number: ')),
    ENVIRONMENTS.length,
  );
  const env = ENVIRONMENTS[envIdx];

  // Stack name resolution
  let caStackName: string;
  let csrStackName: string;

  if (env === 'dev') {
    caStackName = (
      await prompt.question(
        styleText('bold', 'CA CloudFormation stack name (dvs-ca): '),
      )
    ).replace(/\s/g, '');
    if (!caStackName) caStackName = DEFAULT_CA_STACK_NAME;

    csrStackName = (
      await prompt.question(
        styleText('bold', 'CSR CloudFormation stack name (verifier-csr): '),
      )
    ).replace(/\s/g, '');
    if (!csrStackName) csrStackName = 'verifier-csr';
  } else {
    caStackName = DEFAULT_CA_STACK_NAME;
    csrStackName = 'verifier-csr';
  }

  setCaStackName(caStackName);
  setCsrStackName(csrStackName);

  // Assume the L3 operator role for S3/KMS permissions
  console.log(styleText('dim', '\nAssuming operator role …'));
  await assumeOperatorRole();
  console.log(styleText('green', '✓ Assumed L3IssueRevokeOperatorRole'));

  // Resolve CA ARN
  const caArn = await getCaArn();
  console.log(styleText('green', '✓ CA ARN: ') + styleText('dim', caArn));

  // Dispatch
  if (command === 'issue') await handleIssue(prompt, caArn);
  if (command === 'revoke') await handleRevoke(prompt, caArn);
}

try {
  await main();
} catch (err) {
  abort(`Error: ${(err as Error).message}`);
}
