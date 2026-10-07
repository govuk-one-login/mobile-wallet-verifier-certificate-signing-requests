import type { Context, S3Event, S3EventRecord } from 'aws-lambda';
import { expect, vi, type MockInstance } from 'vitest';
import { emptySuccess, successResult } from '../../../utils/result/result.ts';
import type { CsrValidatorDependencies } from '../../handler-dependencies.ts';

export const SOURCE_BUCKET = 'mock-csr-received-bucket';
export const VALIDATED_BUCKET = 'mock-csr-validated-bucket';
export const VERSION_ID = 'mockVersionId';

export type RecordOverrides = {
  key?: string;
  versionId?: string | null;
};

const buildS3Record = (overrides: RecordOverrides = {}): S3EventRecord => {
  const { key = 'incoming/org.pem', versionId = VERSION_ID } = overrides;
  return {
    eventVersion: '2.1',
    eventSource: 'aws:s3',
    awsRegion: 'eu-west-2',
    eventTime: '2026-10-01T12:00:00.000Z',
    eventName: 'ObjectCreated:Put',
    userIdentity: { principalId: 'mockPrincipalId' },
    requestParameters: { sourceIPAddress: '127.0.0.1' },
    responseElements: {
      'x-amz-request-id': 'mockRequestId',
      'x-amz-id-2': 'mockId2',
    },
    s3: {
      s3SchemaVersion: '1.0',
      configurationId: 'mockConfigurationId',
      bucket: {
        name: SOURCE_BUCKET,
        ownerIdentity: { principalId: 'mockPrincipalId' },
        arn: `arn:aws:s3:::${SOURCE_BUCKET}`,
      },
      object: {
        key,
        size: 512,
        eTag: 'mockETag',
        sequencer: 'mockSequencer',
        ...(versionId === null ? {} : { versionId }),
      },
    },
  };
};

export const buildS3Event = (...records: RecordOverrides[]): S3Event => ({
  Records: (records.length ? records : [{}]).map(buildS3Record),
});

export const buildLambdaContext = (): Context => ({
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'mockFunctionName',
  functionVersion: '1',
  invokedFunctionArn:
    'arn:aws:lambda:eu-west-2:123456789012:function:mockFunctionName',
  memoryLimitInMB: '512',
  awsRequestId: 'mockRequestId',
  logGroupName: '/aws/lambda/mockFunctionName',
  logStreamName: '2026/10/01/[$LATEST]mockLogStream',
  getRemainingTimeInMillis: () => 10000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
});

export const toBytes = (text: string): Uint8Array =>
  new TextEncoder().encode(text);

export const buildValidHandlerDependencies = (
  ...objects: Uint8Array[]
): CsrValidatorDependencies => {
  const getS3Object = vi.fn();
  for (const bytes of objects.slice(0, -1)) {
    getS3Object.mockResolvedValueOnce(successResult(bytes));
  }
  getS3Object.mockResolvedValue(successResult(objects.at(-1)));
  return {
    env: { CSR_VALIDATED_BUCKET: VALIDATED_BUCKET },
    getS3Object,
    putS3Object: vi.fn().mockResolvedValue(emptySuccess()),
  };
};

export type PutCall = {
  bucket: string;
  key: string;
  body: Uint8Array | string;
  contentType: string;
};

export const putCallsOf = (dependencies: CsrValidatorDependencies): PutCall[] =>
  vi.mocked(dependencies.putS3Object).mock.calls.map(([input]) => input);

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'log';

export type ConsoleSpies = Record<LogLevel, MockInstance>;

const spyOnLevel = (level: LogLevel): MockInstance =>
  vi.spyOn(console, level).mockImplementation(() => {});

export const spyOnConsole = (): ConsoleSpies => ({
  debug: spyOnLevel('debug'),
  info: spyOnLevel('info'),
  warn: spyOnLevel('warn'),
  error: spyOnLevel('error'),
  log: spyOnLevel('log'),
});

export const logOutputOf = (spies: ConsoleSpies): string =>
  Object.values(spies)
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map(String).join(' '))
    .join('\n');

export const logEntriesOf = (
  spy: MockInstance,
  messageCode: string,
): Record<string, unknown>[] =>
  spy.mock.calls
    .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    .filter((entry) => entry.messageCode === messageCode);

export const base64LinesOf = (pem: string): string[] =>
  pem
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('-----'));

export const expectNoCsrMaterialLogged = (
  spies: ConsoleSpies,
  ...pems: string[]
): void => {
  const output = logOutputOf(spies);
  expect(output).toContain('CSR_VALIDATOR_');
  expect(output).not.toContain('BEGIN CERTIFICATE REQUEST');
  for (const pem of pems) {
    const lines = base64LinesOf(pem);
    for (const line of lines) {
      expect(output).not.toContain(line);
    }
    expect(output).not.toContain(lines.join('').slice(0, 48));
  }
};
