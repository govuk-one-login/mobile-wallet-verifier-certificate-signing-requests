import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadCloudFormationTemplate } from '../../../tests/infraTests/step-definitions/shared-helpers/cfn-test-utils.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

type SamBuildProperties = {
  EntryPoints: string[];
  Minify: boolean;
  Target: string;
  Format?: string;
  OutExtension?: string[];
};

type ValidatorFunction = {
  Metadata: { BuildProperties: SamBuildProperties };
  Properties: { Handler: string };
};

const readValidatorFunction = (): ValidatorFunction => {
  const template = loadCloudFormationTemplate(
    join(REPOSITORY_ROOT, 'template.yaml'),
  );
  return template.Resources.CsrValidatorFunction as ValidatorFunction;
};

const LOAD_SCRIPT =
  'const bundle = require(process.argv[1]);' +
  'process.stdout.write(typeof bundle[process.argv[2]]);';

describe('Handler - bundle load', () => {
  const { Metadata, Properties } = readValidatorFunction();
  const { EntryPoints, Minify, Target, Format, OutExtension } =
    Metadata.BuildProperties;
  const [handlerFile, handlerExport] = Properties.Handler.split('.');
  let workDir: string;
  let bundlePath: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'csr-validator-bundle-'));
    bundlePath = join(workDir, `${handlerFile}.js`);
    await build({
      entryPoints: EntryPoints.map((entry) => join(REPOSITORY_ROOT, entry)),
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: Target,
      minify: Minify,
      sourcemap: false,
      logLevel: 'silent',
    });
  }, 60_000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('is built as the CommonJS file the Handler setting names', () => {
    expect(EntryPoints.map((entry) => parse(entry).name)).toStrictEqual([
      handlerFile,
    ]);
    expect(Format ?? 'cjs').toBe('cjs');
    expect(OutExtension).toBeUndefined();
  });

  it('loads in a clean Node process and exports the handler function', () => {
    const child = spawnSync(
      process.execPath,
      ['-e', LOAD_SCRIPT, bundlePath, handlerExport!],
      { env: { PATH: process.env.PATH }, encoding: 'utf8' },
    );

    expect({
      status: child.status,
      stdout: child.stdout,
      stderr: readableLinesOf(child.stderr),
    }).toStrictEqual({ status: 0, stdout: 'function', stderr: '' });
  });
});

const readableLinesOf = (stderr: string): string =>
  stderr
    .split('\n')
    .filter((line) => line.length < 500)
    .join('\n')
    .trim();
