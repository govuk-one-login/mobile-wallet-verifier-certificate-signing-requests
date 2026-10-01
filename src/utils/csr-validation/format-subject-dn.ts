import type { DnAttribute } from './types.ts';

const ALWAYS_ESCAPED = new Set(['"', '+', ',', ';', '<', '>', '\\']);

export function formatSubjectDn(attrs: readonly DnAttribute[]): string {
  return attrs
    .map(({ name, value }) => `${name}=${escapeValue(value)}`)
    .join(',');
}

function escapeValue(value: string): string {
  const chars = [...value];
  return chars
    .map((char, index) => escapeChar(char, index, chars.length))
    .join('');
}

function escapeChar(char: string, index: number, length: number): string {
  if (char === '\0') return String.raw`\00`;
  if (ALWAYS_ESCAPED.has(char)) return `\\${char}`;
  if (index === 0 && (char === ' ' || char === '#')) return `\\${char}`;
  if (index === length - 1 && char === ' ') return String.raw`\ `;
  return char;
}
