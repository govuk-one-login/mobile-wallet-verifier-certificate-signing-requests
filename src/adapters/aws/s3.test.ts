import {
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  S3ClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from '@aws-sdk/client-s3';
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
  successResult,
} from '../../utils/result/result.ts';
import { getS3Object, putS3Object, s3Client } from './s3.ts';

const CONSOLE_LEVELS = ['debug', 'info', 'warn', 'error', 'log'] as const;

const accessDenied = Object.assign(new Error('Access Denied'), {
  name: 'AccessDenied',
});

const PEM_TEXT =
  '-----BEGIN CERTIFICATE REQUEST-----\nTU9DS19DU1JfQk9EWQ==\n-----END CERTIFICATE REQUEST-----\n';

const mockBucket = 'mockBucket';
const mockBytes = new TextEncoder().encode(PEM_TEXT);

const bodyOf = (bytes: Uint8Array) =>
  ({
    transformToByteArray: async () => bytes,
  }) as unknown as GetObjectCommandOutput['Body'];

describe('S3 client', () => {
  it('makes at most 3 attempts per request', async () => {
    expect(await s3Client.config.maxAttempts()).toBe(3);
  });

  it('fails a connection or request that takes longer than 5 seconds', async () => {
    const requestHandler = s3Client.config.requestHandler as unknown as {
      configProvider: Promise<Record<string, unknown>>;
    };

    expect(await requestHandler.configProvider).toMatchObject({
      connectionTimeout: 5000,
      requestTimeout: 5000,
      throwOnRequestTimeout: true,
    });
  });
});

describe('S3 object operations', () => {
  let consoleDebugSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let consoleSpies: MockInstance[];
  let s3Mock: AwsStub<
    ServiceInputTypes,
    ServiceOutputTypes,
    S3ClientResolvedConfig
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
    s3Mock = mockClient(s3Client);
  });

  afterEach(() => {
    s3Mock.restore();
    vi.restoreAllMocks();
  });

  describe('Getting an object from S3', () => {
    let result: Result<Uint8Array, void>;
    const mockKey = 'incoming/mock file.pem';
    const mockVersionId = 'mockVersionId';
    const input = {
      bucket: mockBucket,
      key: mockKey,
      versionId: mockVersionId,
    };

    describe('On every invocation', () => {
      beforeEach(async () => {
        s3Mock.on(GetObjectCommand).resolves({ Body: bodyOf(mockBytes) });

        await getS3Object(input);
      });

      it('Logs attempt at debug level', () => {
        expect(consoleDebugSpy).toHaveBeenCalledWithLogFields({
          messageCode: 'CSR_VALIDATOR_GET_S3_OBJECT_ATTEMPT',
          data: {
            bucket: mockBucket,
            key: mockKey,
            versionId: mockVersionId,
          },
        });
      });
    });

    describe('Given getting the object fails', () => {
      beforeEach(async () => {
        s3Mock.on(GetObjectCommand).rejects(accessDenied);

        result = await getS3Object(input);
      });

      it('Attempts to get the exact object version', () => {
        expect(s3Mock).toHaveReceivedCommandWith(GetObjectCommand, {
          Bucket: mockBucket,
          Key: mockKey,
          VersionId: mockVersionId,
        });
      });

      it('Logs failed attempt', () => {
        expect(consoleErrorSpy).toHaveBeenCalledWithLogFields({
          messageCode: 'CSR_VALIDATOR_GET_S3_OBJECT_FAILURE',
          error: { name: 'AccessDenied', message: 'Access Denied' },
          data: { bucket: mockBucket, key: mockKey, versionId: mockVersionId },
        });
      });

      it('Returns emptyFailure Result', () => {
        expect(result).toEqual(emptyFailure());
      });
    });

    describe('Given reading the response body fails', () => {
      beforeEach(async () => {
        s3Mock.on(GetObjectCommand).resolves({
          Body: {
            transformToByteArray: async () => {
              throw new Error('Stream aborted');
            },
          } as unknown as GetObjectCommandOutput['Body'],
        });

        result = await getS3Object(input);
      });

      it('Logs failed attempt', () => {
        expect(consoleErrorSpy).toHaveBeenCalledWithLogFields({
          messageCode: 'CSR_VALIDATOR_GET_S3_OBJECT_FAILURE',
          error: { name: 'Error', message: 'Stream aborted' },
          data: { bucket: mockBucket, key: mockKey, versionId: mockVersionId },
        });
      });

      it('Returns emptyFailure Result', () => {
        expect(result).toEqual(emptyFailure());
      });
    });

    describe('Given the response has no body', () => {
      beforeEach(async () => {
        s3Mock.on(GetObjectCommand).resolves({});

        result = await getS3Object(input);
      });

      it('Logs failed attempt', () => {
        expect(consoleErrorSpy).toHaveBeenCalledWithLogFields({
          messageCode: 'CSR_VALIDATOR_GET_S3_OBJECT_FAILURE',
          errorMessage: 'S3 response has no body',
          data: { bucket: mockBucket, key: mockKey, versionId: mockVersionId },
        });
      });

      it('Returns emptyFailure Result', () => {
        expect(result).toEqual(emptyFailure());
      });
    });

    describe('Given getting the object succeeds', () => {
      beforeEach(async () => {
        s3Mock.on(GetObjectCommand).resolves({ Body: bodyOf(mockBytes) });

        result = await getS3Object(input);
      });

      it('Logs successful attempt at debug level', () => {
        expect(consoleDebugSpy).toHaveBeenCalledWithLogFields({
          messageCode: 'CSR_VALIDATOR_GET_S3_OBJECT_SUCCESS',
        });
      });

      it('Returns a Success Result with the object bytes', () => {
        expect(result).toStrictEqual(successResult(mockBytes));
      });

      it('Does not log the object content', () => {
        expect(loggedOutput()).toContain('CSR_VALIDATOR_GET_S3_OBJECT_SUCCESS');
        expect(loggedOutput()).not.toContain('BEGIN CERTIFICATE REQUEST');
        expect(loggedOutput()).not.toContain('TU9DS19DU1JfQk9EWQ==');
      });
    });

    describe('Given no version id is supplied', () => {
      beforeEach(async () => {
        s3Mock.on(GetObjectCommand).resolves({ Body: bodyOf(mockBytes) });

        result = await getS3Object({ bucket: mockBucket, key: mockKey });
      });

      it('Gets the latest object version', () => {
        const [call] = s3Mock.commandCalls(GetObjectCommand);

        expect(call!.args[0].input).toStrictEqual({
          Bucket: mockBucket,
          Key: mockKey,
          VersionId: undefined,
        });
      });

      it('Returns a Success Result with the object bytes', () => {
        expect(result).toStrictEqual(successResult(mockBytes));
      });
    });
  });

  describe('Putting an object to S3', () => {
    let result: Result<void, void>;
    const mockKey = 'validated/mockSha256.pem';
    const mockContentType = 'application/x-pem-file';
    const input = {
      bucket: mockBucket,
      key: mockKey,
      body: mockBytes,
      contentType: mockContentType,
    };

    describe('On every invocation', () => {
      beforeEach(async () => {
        s3Mock.on(PutObjectCommand).resolves({});

        await putS3Object(input);
      });

      it('Logs attempt at debug level', () => {
        expect(consoleDebugSpy).toHaveBeenCalledWithLogFields({
          messageCode: 'CSR_VALIDATOR_PUT_S3_OBJECT_ATTEMPT',
          data: {
            bucket: mockBucket,
            key: mockKey,
            contentType: mockContentType,
          },
        });
      });
    });

    describe('Given putting the object fails', () => {
      beforeEach(async () => {
        s3Mock.on(PutObjectCommand).rejects(accessDenied);

        result = await putS3Object(input);
      });

      it('Attempts to put the object', () => {
        expect(s3Mock).toHaveReceivedCommandWith(PutObjectCommand, {
          Bucket: mockBucket,
          Key: mockKey,
          Body: mockBytes,
          ContentType: mockContentType,
        });
      });

      it('Logs failed attempt', () => {
        expect(consoleErrorSpy).toHaveBeenCalledWithLogFields({
          messageCode: 'CSR_VALIDATOR_PUT_S3_OBJECT_FAILURE',
          error: { name: 'AccessDenied', message: 'Access Denied' },
          data: {
            bucket: mockBucket,
            key: mockKey,
            contentType: mockContentType,
          },
        });
      });

      it('Returns emptyFailure Result', () => {
        expect(result).toEqual(emptyFailure());
      });

      it('Does not log the object content', () => {
        expect(loggedOutput()).toContain('CSR_VALIDATOR_PUT_S3_OBJECT_FAILURE');
        expect(loggedOutput()).not.toContain('BEGIN CERTIFICATE REQUEST');
        expect(loggedOutput()).not.toContain('TU9DS19DU1JfQk9EWQ==');
      });
    });

    describe('Given putting bytes succeeds', () => {
      beforeEach(async () => {
        s3Mock.on(PutObjectCommand).resolves({});

        result = await putS3Object(input);
      });

      it('Sends the bytes unchanged with the content type', () => {
        const [call] = s3Mock.commandCalls(PutObjectCommand);

        expect(call!.args[0].input).toStrictEqual({
          Bucket: mockBucket,
          Key: mockKey,
          Body: mockBytes,
          ContentType: mockContentType,
        });
        expect(call!.args[0].input.Body).toBe(mockBytes);
      });

      it('Logs successful attempt at debug level', () => {
        expect(consoleDebugSpy).toHaveBeenCalledWithLogFields({
          messageCode: 'CSR_VALIDATOR_PUT_S3_OBJECT_SUCCESS',
        });
      });

      it('Returns an emptySuccess Result', () => {
        expect(result).toStrictEqual(emptySuccess());
      });

      it('Does not log the object content', () => {
        expect(loggedOutput()).toContain('CSR_VALIDATOR_PUT_S3_OBJECT_SUCCESS');
        expect(loggedOutput()).not.toContain('BEGIN CERTIFICATE REQUEST');
        expect(loggedOutput()).not.toContain('TU9DS19DU1JfQk9EWQ==');
      });
    });

    describe('Given putting a string succeeds', () => {
      const mockJson = JSON.stringify({ status: 'pass' });

      beforeEach(async () => {
        s3Mock.on(PutObjectCommand).resolves({});

        result = await putS3Object({
          bucket: mockBucket,
          key: 'validated/mockSha256.json',
          body: mockJson,
          contentType: 'application/json',
        });
      });

      it('Sends the string with the content type', () => {
        expect(s3Mock).toHaveReceivedCommandWith(PutObjectCommand, {
          Bucket: mockBucket,
          Key: 'validated/mockSha256.json',
          Body: mockJson,
          ContentType: 'application/json',
        });
      });

      it('Returns an emptySuccess Result', () => {
        expect(result).toStrictEqual(emptySuccess());
      });
    });
  });
});
