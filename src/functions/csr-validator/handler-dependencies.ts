import { Result } from '../../utils/result/result.ts';
import {
  getS3Object,
  GetS3ObjectInput,
} from '../../adapters/aws/s3/getS3Object.ts';
import {
  putS3Object,
  PutS3ObjectInput,
} from '../../adapters/aws/s3/putS3Object.ts';

export type CsrValidatorDependencies = {
  env: NodeJS.ProcessEnv;
  getS3Object: (input: GetS3ObjectInput) => Promise<Result<Uint8Array, void>>;
  putS3Object: (input: PutS3ObjectInput) => Promise<Result<void, void>>;
};

export const runtimeDependencies: CsrValidatorDependencies = {
  env: process.env,
  getS3Object,
  putS3Object,
};
