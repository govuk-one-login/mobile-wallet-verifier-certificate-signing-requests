import { describe, it, expect } from 'vitest';
import {
  successResult,
  errorResult,
  emptySuccess,
  emptyFailure,
} from './result.ts';

describe('Result', () => {
  describe('successResult', () => {
    it('returns an object with isError false and the provided value', () => {
      const result = successResult('hello');
      expect(result).toStrictEqual({ isError: false, value: 'hello' });
    });
  });

  describe('errorResult', () => {
    it('returns an object with isError true and the provided value', () => {
      const result = errorResult({
        errorMessage: 'something went wrong',
      });
      expect(result).toStrictEqual({
        isError: true,
        value: { errorMessage: 'something went wrong' },
      });
    });
  });

  describe('emptySuccess', () => {
    it('returns an object with isError false and no value', () => {
      const result = emptySuccess();
      expect(result).toStrictEqual({ isError: false });
      expect(result).not.toHaveProperty('value');
    });
  });

  describe('emptyFailure', () => {
    it('returns an object with isError true and no value', () => {
      const result = emptyFailure();
      expect(result).toStrictEqual({ isError: true });
      expect(result).not.toHaveProperty('value');
    });
  });
});
