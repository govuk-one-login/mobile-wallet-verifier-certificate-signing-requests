import 'reflect-metadata';
import { describe, test } from 'vitest';
import { setJestCucumberConfiguration } from 'jest-cucumber';

setJestCucumberConfiguration({
  runner: { describe, test },
});
