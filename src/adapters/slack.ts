import { emptyFailure, emptySuccess, Result } from '../utils/result/result.ts';
import { logger } from '../utils/logging/logger.ts';
import { LogMessage } from '../utils/logging/log-message.ts';

const REQUEST_TIMEOUT_MS = 5000;

export type PostSlackMessageInput = {
  webhookUrl: string;
  message: string;
};

/**
 * Posts a message to a Slack incoming webhook.
 *
 * This is a best-effort side channel: it never throws and never surfaces the
 * webhook URL (a secret) in logs or results. Callers treat a failure as
 * non-fatal — the validation outcome has already been persisted by the time
 * this runs — so the Result is returned for observability, not control flow.
 */
export const postSlackMessage = async (
  input: PostSlackMessageInput,
): Promise<Result<void, void>> => {
  const { webhookUrl, message } = input;
  try {
    logger.debug(LogMessage.CSR_VALIDATOR_NOTIFY_ATTEMPT);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.error(LogMessage.CSR_VALIDATOR_NOTIFY_FAILURE, {
        data: { status: response.status },
      });
      return emptyFailure();
    }
  } catch (error: unknown) {
    logger.error(LogMessage.CSR_VALIDATOR_NOTIFY_FAILURE, { error });
    return emptyFailure();
  }

  logger.debug(LogMessage.CSR_VALIDATOR_NOTIFY_SUCCESS);
  return emptySuccess();
};
