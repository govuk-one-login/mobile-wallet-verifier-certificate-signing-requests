import { readFileSync } from 'fs';
import {
  load,
  CORE_SCHEMA,
  Schema,
  defineScalarTag,
  defineSequenceTag,
  defineMappingTag,
} from 'js-yaml';

// CloudFormation Template Interface
export interface CloudFormationTemplate {
  AWSTemplateFormatVersion: string;
  Transform: string;
  Description: string;
  Parameters: Record<string, unknown>;
  Resources: Record<string, unknown>;
  Outputs: Record<string, unknown>;
  Globals?: Record<string, unknown>;
  Mappings?: Record<string, unknown>;
  Conditions?: Record<string, unknown>;
}

// Handle CloudFormation intrinsic functions that can appear in different contexts
const createCfnTags = (tag: string, fnName: string) => [
  defineScalarTag(tag, { resolve: (data: string) => ({ [fnName]: data }) }),
  defineSequenceTag(tag, {
    create: () => [] as unknown[],
    addItem: (arr: unknown[], item: unknown) => {
      arr.push(item);
    },
    finalize: (arr: unknown[]) => ({ [fnName]: arr }),
  }),
  defineMappingTag(tag, {
    create: () => ({}) as Record<string, unknown>,
    addPair: (obj: Record<string, unknown>, key: unknown, value: unknown) => {
      obj[key as string] = value;
      return '';
    },
    has: (obj: Record<string, unknown>, key: unknown) => (key as string) in obj,
    keys: (obj: Record<string, unknown>) => Object.keys(obj),
    get: (obj: Record<string, unknown>, key: unknown) => obj[key as string],
    finalize: (obj: Record<string, unknown>) => ({ [fnName]: obj }),
  }),
];

const cfnTags = [
  ...createCfnTags('!Sub', 'Fn::Sub'),
  ...createCfnTags('!Ref', 'Ref'),
  ...createCfnTags('!GetAtt', 'Fn::GetAtt'),
  ...createCfnTags('!FindInMap', 'Fn::FindInMap'),
  ...createCfnTags('!ImportValue', 'Fn::ImportValue'),
  ...createCfnTags('!If', 'Fn::If'),
  ...createCfnTags('!Not', 'Fn::Not'),
  ...createCfnTags('!Equals', 'Fn::Equals'),
  ...createCfnTags('!Or', 'Fn::Or'),
  ...createCfnTags('!And', 'Fn::And'),
  ...createCfnTags('!Condition', 'Condition'),
  ...createCfnTags('!Join', 'Fn::Join'),
  ...createCfnTags('!Select', 'Fn::Select'),
  ...createCfnTags('!Split', 'Fn::Split'),
];

const cfnSchema = new Schema([...CORE_SCHEMA.tags, ...cfnTags]);

// Utility Functions
export function loadCloudFormationTemplate(
  templatePath: string,
): CloudFormationTemplate {
  const templateContent = readFileSync(templatePath, 'utf8');
  return load(templateContent, { schema: cfnSchema }) as CloudFormationTemplate;
}

export const ENVIRONMENT_VALUES = [
  'dev',
  'build',
  'staging',
  'integration',
  'prod',
];

// Common test helpers
export function testTemplateStructure(template: CloudFormationTemplate) {
  if (template.AWSTemplateFormatVersion !== '2010-09-09')
    throw new Error('Invalid AWSTemplateFormatVersion');
  if (template.Transform !== 'AWS::Serverless-2016-10-31')
    throw new Error('Invalid Transform');
  if (!template.Description?.includes('Verifier Certificate Authority backend'))
    throw new Error('Invalid Description');
}

export function testRequiredSections(
  template: CloudFormationTemplate,
  includeGlobals = false,
) {
  if (!template.Parameters) throw new Error('Parameters not defined');
  if (!template.Resources) throw new Error('Resources not defined');
  if (!template.Outputs) throw new Error('Outputs not defined');
  if (includeGlobals && !template.Globals)
    throw new Error('Globals not defined');
}

export function testEnvironmentParameter(template: CloudFormationTemplate) {
  const envParam = template.Parameters.Environment as Record<string, unknown>;
  if (envParam.Type !== 'String') throw new Error('Invalid Environment Type');
  if (envParam.Default !== 'dev')
    throw new Error('Invalid Environment Default');
  if (
    JSON.stringify(envParam.AllowedValues) !==
    JSON.stringify(ENVIRONMENT_VALUES)
  )
    throw new Error('Invalid AllowedValues');
}

export function testRequiredParameters(
  template: CloudFormationTemplate,
  params: string[],
) {
  params.forEach((param) => {
    if (!template.Parameters[param])
      throw new Error(`Parameter ${param} not defined`);
  });
}

export function testRequiredOutputs(
  template: CloudFormationTemplate,
  outputs: string[],
) {
  outputs.forEach((output) => {
    if (!template.Outputs[output])
      throw new Error(`Output ${output} not defined`);
  });
}
