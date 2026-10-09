import {
  PublishCommand,
  SNSClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from '@aws-sdk/client-sns';
import { AwsStub, mockClient } from 'aws-sdk-client-mock';
import {
  vi,
  expect,
  it,
  describe,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';
import '../../utils/test/matchers.ts';
import {
  emptyFailure,
  emptySuccess,
  Result,
} from '../../utils/result/result.ts';
import { publishMessage, snsClient } from './sns.ts';

const CONSOLE_LEVELS = ['debug', 'info', 'warn', 'error', 'log'] as const;

const accessDenied = Object.assign(new Error('Access Denied'), {
  name: 'AccessDenied',
});

const TOPIC_ARN = 'arn:aws:sns:eu-west-2:123456789012:mock-topic';
const SUBJECT = 'CSR validation passed: incoming/org.pem';
const MESSAGE = 'CSR validation passed.\n\nOriginal: incoming/org.pem';

describe('SNS notification adapter', () => {
  let consoleDebugSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let consoleSpies: MockInstance[];
  let snsMock: AwsStub<
    ServiceInputTypes,
    ServiceOutputTypes,
    SNSClientResolvedConfig
  >;

  const spyOn = (level: (typeof CONSOLE_LEVELS)[number]): MockInstance =>
    vi.spyOn(console, level).mockImplementation(() => {});

  const loggedOutput = () =>
    consoleSpies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map(String).join(' '))
      .join('\n');

  beforeEach(() => {
    consoleSpies = CONSOLE_LEVELS.map(spyOn);
    consoleDebugSpy = spyOn('debug');
    consoleErrorSpy = spyOn('error');
    snsMock = mockClient(snsClient);
  });

  afterEach(() => {
    snsMock.restore();
    vi.restoreAllMocks();
  });

  describe('S3 client parity', () => {
    it('makes at most 3 attempts per request', async () => {
      expect(await snsClient.config.maxAttempts()).toBe(3);
    });
  });

  describe('Given publishing succeeds', () => {
    let result: Result<void, void>;

    beforeEach(async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'mockMessageId' });

      result = await publishMessage({
        topicArn: TOPIC_ARN,
        subject: SUBJECT,
        message: MESSAGE,
      });
    });

    it('publishes the subject and message to the topic', () => {
      expect(snsMock).toHaveReceivedCommandWith(PublishCommand, {
        TopicArn: TOPIC_ARN,
        Subject: SUBJECT,
        Message: MESSAGE,
      });
    });

    it('returns an emptySuccess Result', () => {
      expect(result).toStrictEqual(emptySuccess());
    });

    it('logs a successful attempt at debug level', () => {
      expect(consoleDebugSpy).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_NOTIFY_SUCCESS',
        data: { topicArn: TOPIC_ARN, subject: SUBJECT },
      });
    });
  });

  describe('Given publishing fails', () => {
    let result: Result<void, void>;

    beforeEach(async () => {
      snsMock.on(PublishCommand).rejects(accessDenied);

      result = await publishMessage({
        topicArn: TOPIC_ARN,
        subject: SUBJECT,
        message: MESSAGE,
      });
    });

    it('returns an emptyFailure Result without throwing', () => {
      expect(result).toStrictEqual(emptyFailure());
    });

    it('logs the failure', () => {
      expect(consoleErrorSpy).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_NOTIFY_FAILURE',
        error: { name: 'AccessDenied', message: 'Access Denied' },
        data: { topicArn: TOPIC_ARN, subject: SUBJECT },
      });
    });

    it('does not log the message body', () => {
      expect(loggedOutput()).toContain('CSR_VALIDATOR_NOTIFY_FAILURE');
      expect(loggedOutput()).not.toContain('Original: incoming/org.pem');
    });
  });
});
