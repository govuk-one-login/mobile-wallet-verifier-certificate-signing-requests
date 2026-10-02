import {
  errorResult,
  Result,
  successResult,
  SuccessWithValue,
} from '../result/result.ts';

export type MissingEnvVarError = {
  missingEnvVars: string[];
};

export type Config<T extends string> = {
  [key in T]: string;
};

export const getRequiredEnvironmentVariables = <T extends string>(
  env: NodeJS.ProcessEnv,
  requiredEnvironmentVariables: readonly T[],
): Result<Config<T>, MissingEnvVarError> => {
  const config = Object.fromEntries(
    requiredEnvironmentVariables.map((key) => [key, env[key]]),
  ) as Partial<Config<T>>;

  const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
    (key) => !config[key],
  );

  if (missingEnvironmentVariables.length >= 1) {
    return errorResult({
      missingEnvVars: missingEnvironmentVariables,
    });
  }
  return successResult(config) as SuccessWithValue<Config<T>>;
};
