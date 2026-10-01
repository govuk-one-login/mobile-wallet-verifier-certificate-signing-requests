import {
  GetObjectCommand,
  GetObjectCommandOutput,
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
import '../../../utils/test/matchers.ts';
import {
  emptyFailure,
  Result,
  successResult,
} from '../../../utils/result/result.ts';
import { getS3Object } from './getS3Object.ts';
import { s3Client } from './s3Client.ts';

const CONSOLE_LEVELS = ['debug', 'info', 'warn', 'error', 'log'] as const;

const accessDenied = Object.assign(new Error('Access Denied'), {
  name: 'AccessDenied',
});

const PEM_TEXT =
  '-----BEGIN CERTIFICATE REQUEST-----\nTU9DS19DU1JfQk9EWQ==\n-----END CERTIFICATE REQUEST-----\n';

const bodyOf = (bytes: Uint8Array) =>
  ({
    transformToByteArray: async () => bytes,
  }) as unknown as GetObjectCommandOutput['Body'];

describe('Getting an object from S3', () => {
  let consoleDebugSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let consoleSpies: MockInstance[];
  let s3Mock: AwsStub<
    ServiceInputTypes,
    ServiceOutputTypes,
    S3ClientResolvedConfig
  >;
  let result: Result<Uint8Array, void>;
  const mockBucket = 'mockBucket';
  const mockKey = 'incoming/mock file.pem';
  const mockVersionId = 'mockVersionId';
  const mockBytes = new TextEncoder().encode(PEM_TEXT);
  const input = { bucket: mockBucket, key: mockKey, versionId: mockVersionId };

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
