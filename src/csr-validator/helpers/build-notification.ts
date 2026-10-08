import type { CsrSource } from './parse-s3-record.ts';
import type { ValidationOutcome } from './build-outcome.ts';

/**
 * Formats the operator-facing Slack message for a validation outcome.
 *
 * Kept pure and separate from the handler (mirroring build-outcome) so the
 * wording is unit-testable and the handler stays orchestration-only. The
 * message deliberately carries the original source key alongside the SHA-256,
 * since that mapping is otherwise only discoverable from the logs.
 */
export const buildNotification = (
  source: CsrSource,
  outcome: ValidationOutcome,
): string => {
  const { status, sha256 } = outcome.resultRecord;
  const statusLine = status === 'pass' ? ':white_check_mark: pass' : ':x: fail';

  return [
    `*Original:* ${source.key}`,
    `*SHA-256:* ${sha256 ?? 'N/A'}`,
    `*Status:* ${statusLine}`,
  ].join('\n');
};
