import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  emptyFailure,
  emptySuccess,
  Result,
} from '../../utils/result/result.ts';
import { logger } from '../../utils/logging/logger.ts';
import { LogMessage } from '../../utils/logging/log-message.ts';

export const snsClient = new SNSClient({
  region: process.env.AWS_REGION,
  maxAttempts: 3,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 5000,
    throwOnRequestTimeout: true,
  }),
});

export type PublishMessageInput = {
  topicArn: string;
  subject: string;
  message: string;
};

export const publishMessage = async (
  input: PublishMessageInput,
): Promise<Result<void, void>> => {
  const { topicArn, subject, message } = input;
  const data = { topicArn, subject };
  try {
    logger.debug(LogMessage.CSR_VALIDATOR_NOTIFY_ATTEMPT, { data });
    await snsClient.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: subject,
        Message: message,
      }),
    );
  } catch (error: unknown) {
    logger.error(LogMessage.CSR_VALIDATOR_NOTIFY_FAILURE, { error, data });
    return emptyFailure();
  }

  logger.debug(LogMessage.CSR_VALIDATOR_NOTIFY_SUCCESS, { data });
  return emptySuccess();
};
