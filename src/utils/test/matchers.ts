import { expect, MockInstance } from 'vitest';
import 'aws-sdk-client-mock-vitest/extend';

const toHaveBeenCalledWithLogFields = (
  consoleSpy: MockInstance,
  logFields: Record<string, unknown>,
) => {
  const messages = consoleSpy.mock.calls.map((args) => args[0]);
  const pass = messages.some((message) => {
    if (typeof message !== 'string') {
      return false;
    }

    try {
      const messageAsObject = JSON.parse(message);
      return isSubsetOf(logFields, messageAsObject);
    } catch {
      return false;
    }
  });
  return {
    pass,
    message: pass
      ? () =>
          `Expected not to find any log messages matching the specified fields and values: ${JSON.stringify(logFields)}`
      : () =>
          `Expected to find at least one log message matching the specified fields and values: ${JSON.stringify(logFields)}`,
  };
};

function isSubsetOf(
  object: Record<string, unknown>,
  targetObject: Record<string, unknown>,
): boolean {
  return Object.keys(object).every((key) => {
    if (Array.isArray(object[key]) || Array.isArray(targetObject[key])) {
      return deepEquals(object[key], targetObject[key]);
    }
    if (object[key] instanceof Object && targetObject[key] instanceof Object) {
      const objVal = object[key] as Record<string, unknown>;
      const targetObjVal = targetObject[key] as Record<string, unknown>;
      return isSubsetOf(objVal, targetObjVal);
    }
    return deepEquals(object[key], targetObject[key]);
  });
}

function deepEquals(subject: unknown, target: unknown): boolean {
  return JSON.stringify(subject) === JSON.stringify(target);
}

expect.extend({
  toHaveBeenCalledWithLogFields,
});

declare module 'vitest' {
  interface Matchers<T> {
    toHaveBeenCalledWithLogFields: (logFields: Record<string, unknown>) => T;
  }
}
