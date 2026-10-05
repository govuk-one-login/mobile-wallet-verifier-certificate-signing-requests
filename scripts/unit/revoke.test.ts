import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  ACMPCAClient,
  RevokeCertificateCommand,
  RevocationReason,
} from '@aws-sdk/client-acm-pca';
import {
  validateSerialFormat,
  isValidReason,
  revokeCertificate,
  VALID_REASONS,
} from '../lib/issue-revoke/revoke.js';

const pca = mockClient(ACMPCAClient);

const CA_ARN =
  'arn:aws:acm-pca:eu-west-2:123456789012:certificate-authority/abc';

beforeEach(() => {
  pca.reset();
});

// ── validateSerialFormat ────────────────────────────────────────────

describe('validateSerialFormat', () => {
  it('accepts a valid colon-hex serial', () => {
    expect(() =>
      validateSerialFormat('aa:bb:cc:dd'),
    ).not.toThrow();
  });

  it('accepts a two-byte serial', () => {
    expect(() => validateSerialFormat('0a:ff')).not.toThrow();
  });

  it('accepts upper-case hex', () => {
    expect(() => validateSerialFormat('AA:BB:CC')).not.toThrow();
  });

  it('rejects a single byte (no colon)', () => {
    expect(() => validateSerialFormat('aa')).toThrow(
      /Invalid certificate serial/,
    );
  });

  it('rejects missing colons', () => {
    expect(() => validateSerialFormat('aabbccdd')).toThrow(
      /Invalid certificate serial/,
    );
  });

  it('rejects non-hex characters', () => {
    expect(() => validateSerialFormat('gg:hh')).toThrow(
      /Invalid certificate serial/,
    );
  });

  it('rejects empty string', () => {
    expect(() => validateSerialFormat('')).toThrow(
      /Invalid certificate serial/,
    );
  });
});

// ── isValidReason ───────────────────────────────────────────────────

describe('isValidReason', () => {
  it('returns true for valid RevocationReason values', () => {
    for (const reason of VALID_REASONS) {
      expect(isValidReason(reason)).toBe(true);
    }
  });

  it('returns false for arbitrary strings', () => {
    expect(isValidReason('NOT_A_REASON')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidReason('')).toBe(false);
  });
});

// ── revokeCertificate ───────────────────────────────────────────────

describe('revokeCertificate', () => {
  it('sends RevokeCertificateCommand with correct params', async () => {
    pca.on(RevokeCertificateCommand).resolves({});

    await revokeCertificate(
      CA_ARN,
      'aa:bb:cc:dd',
      RevocationReason.KEY_COMPROMISE,
    );

    const calls = pca.commandCalls(RevokeCertificateCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toEqual({
      CertificateAuthorityArn: CA_ARN,
      CertificateSerial: 'aa:bb:cc:dd',
      RevocationReason: RevocationReason.KEY_COMPROMISE,
    });
  });

  it('throws before calling AWS when serial is invalid', async () => {
    await expect(
      revokeCertificate(
        CA_ARN,
        'invalid',
        RevocationReason.UNSPECIFIED,
      ),
    ).rejects.toThrow(/Invalid certificate serial/);

    expect(
      pca.commandCalls(RevokeCertificateCommand),
    ).toHaveLength(0);
  });
});
