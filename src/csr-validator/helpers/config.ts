import {
  Config,
  getRequiredEnvironmentVariables,
  MissingEnvVarError,
} from '../../utils/environment/environment.ts';
import { Result, successResult } from '../../utils/result/result.ts';
import { logger } from '../../utils/logging/logger.ts';
import { LogMessage } from '../../utils/logging/log-message.ts';

const REQUIRED_ENVIRONMENT_VARIABLES = ['CSR_VALIDATED_BUCKET'] as const;

export type CsrValidatorConfig = Config<
  (typeof REQUIRED_ENVIRONMENT_VARIABLES)[number]
> & {
  NOTIFICATION_TOPIC_ARN?: string;
};

export function getCsrValidatorConfig(
  env: NodeJS.ProcessEnv,
): Result<CsrValidatorConfig, MissingEnvVarError> {
  const envVarsResult = getRequiredEnvironmentVariables(
    env,
    REQUIRED_ENVIRONMENT_VARIABLES,
  );
  if (envVarsResult.isError) {
    logger.error(LogMessage.CSR_VALIDATOR_INVALID_CONFIG, {
      data: { missingEnvironmentVariables: envVarsResult.value.missingEnvVars },
    });
    return envVarsResult;
  }

  return successResult({
    ...envVarsResult.value,
    NOTIFICATION_TOPIC_ARN: env.NOTIFICATION_TOPIC_ARN || undefined,
  });
}
