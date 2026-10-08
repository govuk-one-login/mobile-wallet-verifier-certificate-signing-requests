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
  NOTIFICATION_TOPIC_ARN,
  publishCallsOf,
  putCallsOf,
  spyOnConsole,
  toBytes,
  VALIDATED_BUCKET,
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

    it('publishes to the notification topic exactly once', () => {
      expect(dependencies.publishMessage).toHaveBeenCalledOnce();
    });

    it('publishes to the configured topic a pass message with source and sha256', () => {
      const [call] = publishCallsOf(dependencies);
      const payload = JSON.parse(call!.message) as {
        version: string;
        source: string;
        content: { description: string };
      };

      expect(call!.topicArn).toBe(NOTIFICATION_TOPIC_ARN);
      expect(call!.subject).toBe('CSR validation passed: incoming/org.pem');
      expect(payload.version).toBe('1.0');
      expect(payload.source).toBe('custom');
      expect(payload.content.description).toContain(
        '*Original filename:* `incoming/org.pem`',
      );
      expect(payload.content.description).toContain(
        `*SHA-256 filename:* ${sha256}`,
      );
      expect(payload.content.description).toContain('*Status:* pass');
    });

    it('publishes only after the outcome has been persisted', () => {
      const putOrder = vi.mocked(dependencies.putS3Object).mock
        .invocationCallOrder;
      const publishOrder = vi.mocked(dependencies.publishMessage).mock
        .invocationCallOrder;

      expect(Math.max(...putOrder)).toBeLessThan(publishOrder[0]!);
    });
  });

  describe('Given a CSR fails validation', () => {
    beforeEach(async () => {
      dependencies = buildValidHandlerDependencies(
        toBytes(toPem(toBytes('this is not DER at all'))),
      );
      await handlerConstructor(dependencies, buildS3Event(), context);
    });

    it('publishes a fail message', () => {
      const [call] = publishCallsOf(dependencies);
      const payload = JSON.parse(call!.message) as {
        content: { description: string };
      };

      expect(call!.subject).toBe('CSR validation failed: incoming/org.pem');
      expect(payload.content.description).toContain('*Status:* fail');
    });
  });

  describe('Given publishing the notification fails', () => {
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
      vi.mocked(dependencies.publishMessage).mockResolvedValue(emptyFailure());
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

  describe('Given no notification topic is configured', () => {
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
      dependencies.env = { CSR_VALIDATED_BUCKET: VALIDATED_BUCKET };
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

    it('does not publish a notification', () => {
      expect(dependencies.publishMessage).not.toHaveBeenCalled();
    });

    it('logs that the notification was skipped', () => {
      expect(consoleSpies.debug).toHaveBeenCalledWithLogFields({
        messageCode: 'CSR_VALIDATOR_NOTIFY_SKIPPED',
      });
    });
  });
});
