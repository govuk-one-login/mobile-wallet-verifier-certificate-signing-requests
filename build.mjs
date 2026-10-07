import { mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  load,
  CORE_SCHEMA,
  Schema,
  defineScalarTag,
  defineSequenceTag,
  defineMappingTag,
} from 'js-yaml';

const REPOSITORY_ROOT = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(REPOSITORY_ROOT, 'template.yaml');
const OUT_DIR = join(REPOSITORY_ROOT, 'dist');
const FUNCTION_LOGICAL_ID = 'CsrValidatorFunction';

const loadOnly = () => false;

const cfnPassthroughTags = [
  defineScalarTag('!', {
    matchByTagPrefix: true,
    resolve: (source, _isExplicit, tagName) => ({ [tagName]: source }),
    identify: loadOnly,
  }),
  defineSequenceTag('!', {
    matchByTagPrefix: true,
    create: () => [],
    addItem: (carrier, item) => {
      carrier.push(item);
    },
    identify: loadOnly,
  }),
  defineMappingTag('!', {
    matchByTagPrefix: true,
    create: () => ({}),
    addPair: (carrier, key, value) => {
      carrier[key] = value;
      return '';
    },
    has: (carrier, key) => key in carrier,
    keys: (result) => Object.keys(result),
    get: (result, key) => result[key],
    identify: loadOnly,
  }),
];

const cfnSchema = new Schema([...CORE_SCHEMA.tags, ...cfnPassthroughTags]);

const readBuildSettings = () => {
  const template = load(readFileSync(TEMPLATE_PATH, 'utf8'), {
    schema: cfnSchema,
  });

  const lambda = template?.Resources?.[FUNCTION_LOGICAL_ID];
  if (!lambda) {
    throw new Error(`${FUNCTION_LOGICAL_ID} not found in template.yaml`);
  }

  const buildProperties = lambda.Metadata?.BuildProperties;
  const entryPoints = buildProperties?.EntryPoints;
  if (!entryPoints?.length) {
    throw new Error(
      `${FUNCTION_LOGICAL_ID} Metadata.BuildProperties.EntryPoints is missing or empty`,
    );
  }

  const handler = lambda.Properties?.Handler;
  if (typeof handler !== 'string' || !handler.includes('.')) {
    throw new Error(
      `${FUNCTION_LOGICAL_ID} Properties.Handler must be in "<file>.<export>" form`,
    );
  }

  const [handlerFile] = handler.split('.');
  if (entryPoints.length > 1) {
    throw new Error(
      `Expected a single entry point for ${FUNCTION_LOGICAL_ID}, found ${entryPoints.length}`,
    );
  }
  if (parse(entryPoints[0]).name !== handlerFile) {
    throw new Error(
      `Entry point "${entryPoints[0]}" does not match Handler "${handler}"`,
    );
  }

  return {
    entryPoint: join(REPOSITORY_ROOT, entryPoints[0]),
    outfile: join(OUT_DIR, `${handlerFile}.js`),
    target: buildProperties.Target ?? 'es2022',
    minify: buildProperties.Minify ?? false,
    sourcemap: buildProperties.Sourcemap ?? false,
  };
};

const { entryPoint, outfile, target, minify, sourcemap } = readBuildSettings();

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target,
  minify,
  sourcemap,
});

await writeFile(
  join(OUT_DIR, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
);

console.log(`Bundled ${entryPoint} -> ${outfile}`);
