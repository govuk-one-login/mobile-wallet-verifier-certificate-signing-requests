import {
  vi,
  expect,
  it,
  describe,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';
import '../utils/test/matchers.ts';
import { emptyFailure, emptySuccess } from '../utils/result/result.ts';
import { postSlackMessage } from './slack.ts';

const CONSOLE_LEVELS = ['debug', 'info', 'warn', 'error', 'log'] as const;

const WEBHOOK_URL = 'https://hooks.slack.example/T000/B000/XXXXsecretXXXX';
const MESSAGE = '*Status:* pass';

const okResponse = { ok: true, status: 200 } as Response;
const errorResponse = { ok: false, status: 500 } as Response;

describe('Slack notification adapter', () => {
  let consoleSpies: MockInstance[];
  let consoleDebugSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let fetchMock: MockInstance;

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
    fetchMock = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Given Slack accepts the message', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(okResponse);
    });

    it('posts the message as JSON to the webhook with a request timeout', async () => {
      await postSlackMessage({ webhookUrl: WEBHOOK_URL, message: MESSAGE });

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: MESSAGE }),
        signal: expect.any(AbortSignal),
      });
    });

    it('returns an emptySuccess Result', async () => {
      const result = await postSlackMessage({
        webhookUrl: WEBHOOK_URL,
        message: MESSAGE,
      });

      expect(result).toStrictEqual(emptySuccess());
    });

    it('logs a successful attempt', async () => {
      await postSlackMessage({ webhookUrl: WEBHOOK_URL, message: MESSAGE });

      expect(consoleDebugSpy).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_NOTIFY_SUCCESS',
      });
    });

    it('never logs the webhook URL', async () => {
      await postSlackMessage({ webhookUrl: WEBHOOK_URL, message: MESSAGE });

      expect(loggedOutput()).toContain('CSR_VALIDATOR_NOTIFY');
      expect(loggedOutput()).not.toContain(WEBHOOK_URL);
      expect(loggedOutput()).not.toContain('XXXXsecretXXXX');
    });
  });

  describe('Given Slack responds with a non-2xx status', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(errorResponse);
    });

    it('returns an emptyFailure Result without throwing', async () => {
      const result = await postSlackMessage({
        webhookUrl: WEBHOOK_URL,
        message: MESSAGE,
      });

      expect(result).toStrictEqual(emptyFailure());
    });

    it('logs the failure with the status code', async () => {
      await postSlackMessage({ webhookUrl: WEBHOOK_URL, message: MESSAGE });

      expect(consoleErrorSpy).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_NOTIFY_FAILURE',
        data: { status: 500 },
      });
    });
  });

  describe('Given the request throws (network error or timeout)', () => {
    beforeEach(() => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error('The operation was aborted'), {
          name: 'TimeoutError',
        }),
      );
    });

    it('returns an emptyFailure Result without throwing', async () => {
      const result = await postSlackMessage({
        webhookUrl: WEBHOOK_URL,
        message: MESSAGE,
      });

      expect(result).toStrictEqual(emptyFailure());
    });

    it('logs the failure', async () => {
      await postSlackMessage({ webhookUrl: WEBHOOK_URL, message: MESSAGE });

      expect(consoleErrorSpy).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_NOTIFY_FAILURE',
        error: { name: 'TimeoutError' },
      });
    });

    it('never logs the webhook URL', async () => {
      await postSlackMessage({ webhookUrl: WEBHOOK_URL, message: MESSAGE });

      expect(loggedOutput()).not.toContain(WEBHOOK_URL);
    });
  });
});
