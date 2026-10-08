import type { Context } from 'aws-lambda';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { handlerConstructor } from '../handler.ts';
import type { CsrValidatorDependencies } from '../handler-dependencies.ts';
import { sha256Hex } from '../../utils/csr-validation/fingerprint.ts';
import {
  buildCsr,
  derOf,
  toPem,
} from '../../utils/csr-validation/tests/utils/builders.ts';
import { emptyFailure } from '../../utils/result/result.ts';
import {
  buildLambdaContext,
  buildS3Event,
  buildValidHandlerDependencies,
  ConsoleSpies,
  postCallsOf,
  putCallsOf,
  SLACK_WEBHOOK_URL,
  spyOnConsole,
  toBytes,
} from './utils/builders.ts';
import '../../utils/test/matchers.ts';

describe('Handler - Outcome notification', () => {
  let context: Context;
  let consoleSpies: ConsoleSpies;
  let dependencies: CsrValidatorDependencies;

  beforeEach(() => {
    consoleSpies = spyOnConsole();
    context = buildLambdaContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Given a valid CSR passes validation', () => {
    let pem: string;
    let sha256: string;

    beforeEach(async () => {
      pem = await buildCsr({
        subject:
          '2.5.4.5=f47ac10b-58cc-4372-a567-0e02b2c3d479, CN=DVS, OU=DVS PKI Operations, O=DVS.COM, C=GB',
      });
      sha256 = sha256Hex(derOf(pem));
      dependencies = buildValidHandlerDependencies(toBytes(pem));
      await handlerConstructor(dependencies, buildS3Event(), context);
    });

    it('notifies Slack exactly once', () => {
      expect(dependencies.postSlackMessage).toHaveBeenCalledOnce();
    });

    it('sends the configured webhook URL and a pass message with source and sha256', () => {
      const [call] = postCallsOf(dependencies);

      expect(call!.webhookUrl).toBe(SLACK_WEBHOOK_URL);
      expect(call!.message).toContain('*Original:* incoming/org.pem');
      expect(call!.message).toContain(`*SHA-256:* ${sha256}`);
      expect(call!.message).toContain(':white_check_mark: pass');
    });

    it('notifies only after the outcome has been persisted', () => {
      const putOrder = vi.mocked(dependencies.putS3Object).mock
        .invocationCallOrder;
      const postOrder = vi.mocked(dependencies.postSlackMessage).mock
        .invocationCallOrder;

      expect(Math.max(...putOrder)).toBeLessThan(postOrder[0]!);
    });
  });

  describe('Given a CSR fails validation', () => {
    beforeEach(async () => {
      dependencies = buildValidHandlerDependencies(
        toBytes(toPem(toBytes('this is not DER at all'))),
      );
      await handlerConstructor(dependencies, buildS3Event(), context);
    });

    it('notifies Slack with a fail message', () => {
      const [call] = postCallsOf(dependencies);

      expect(call!.message).toContain(':x: fail');
    });
  });

  describe('Given Slack notification fails', () => {
    let pem: string;
    let sha256: string;
    let lambdaError: Error | undefined;

    beforeEach(async () => {
      pem = await buildCsr({
        subject:
          '2.5.4.5=f47ac10b-58cc-4372-a567-0e02b2c3d479, CN=DVS, OU=DVS PKI Operations, O=DVS.COM, C=GB',
      });
      sha256 = sha256Hex(derOf(pem));
      dependencies = buildValidHandlerDependencies(toBytes(pem));
      vi.mocked(dependencies.postSlackMessage).mockResolvedValue(
        emptyFailure(),
      );
      lambdaError = undefined;
      try {
        await handlerConstructor(dependencies, buildS3Event(), context);
      } catch (error: unknown) {
        lambdaError = error as Error;
      }
    });

    it('does not fail the record', () => {
      expect(lambdaError).toBeUndefined();
    });

    it('still persists the validation outcome', () => {
      expect(putCallsOf(dependencies)).toHaveLength(2);
      expect(putCallsOf(dependencies)[0]!.key).toBe(`validated/${sha256}.json`);
    });

    it('still logs the completed outcome', () => {
      expect(consoleSpies.info).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_COMPLETED',
        outcome: 'pass',
      });
    });
  });
});
