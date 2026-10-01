import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';

export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  maxAttempts: 3,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 5000,
    throwOnRequestTimeout: true,
  }),
});
