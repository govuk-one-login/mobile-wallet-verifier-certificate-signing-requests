import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { AWS_REGION, ALLOWED_ROLES } from './constants.js';

export async function assertRole(): Promise<string> {
  const sts = new STSClient({ region: AWS_REGION });
  const { Arn } = await sts.send(new GetCallerIdentityCommand({}));
  const rolePatterns = ALLOWED_ROLES.map(
    (r) =>
      new RegExp(`:assumed-role/${r.replaceAll('*', '[^/]+')}/`),
  );
  if (!Arn || !rolePatterns.some((re) => re.test(Arn))) {
    throw new Error(
      `Access denied. Caller must assume one of: ${ALLOWED_ROLES.join(', ')}.\n` +
        `Current identity: ${Arn ?? 'unknown'}`,
    );
  }
  return Arn;
}
