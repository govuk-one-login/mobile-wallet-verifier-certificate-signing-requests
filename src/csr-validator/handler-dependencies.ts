import { Result } from '../utils/result/result.ts';
import {
  getS3Object,
  GetS3ObjectInput,
  putS3Object,
  PutS3ObjectInput,
} from '../adapters/aws/s3.ts';

export type CsrValidatorDependencies = {
  env: NodeJS.ProcessEnv;
  getS3Object: (input: GetS3ObjectInput) => Promise<Result<Uint8Array, void>>;
  putS3Object: (input: PutS3ObjectInput) => Promise<Result<void, void>>;
  notifySlack: (webhookUrl: string, message: string) => Promise<void>;
};

export const runtimeDependencies: CsrValidatorDependencies = {
  env: process.env,
  getS3Object,
  putS3Object,
  notifySlack: async (webhookUrl, message) => {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
  },
};
