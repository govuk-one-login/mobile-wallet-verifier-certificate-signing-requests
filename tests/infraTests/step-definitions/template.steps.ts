import { loadFeature, defineFeature } from 'jest-cucumber';
import { join } from 'path';
import { expect } from 'vitest';
import {
  CloudFormationTemplate,
  loadCloudFormationTemplate,
  testTemplateStructure,
  testRequiredSections,
  testEnvironmentParameter,
  testRequiredParameters,
} from './shared-helpers/cfn-test-utils.js';

const templateFeature = loadFeature(
  join(__dirname, '../features/template.feature'),
);
const receivedBucketFeature = loadFeature(
  join(__dirname, '../features/received-bucket.feature'),
);
const validatedBucketFeature = loadFeature(
  join(__dirname, '../features/validated-bucket.feature'),
);

let template: CloudFormationTemplate;

const loadTemplate = (given: (s: string, fn: () => void) => void) => {
  given('the CloudFormation template is loaded', () => {
    template = loadCloudFormationTemplate(
      join(__dirname, '../../../template.yaml'),
    );
  });
};

defineFeature(templateFeature, (test) => {
  test('Template has valid structure', ({ given, then, and }) => {
    loadTemplate(given);

    then('the template should have valid CloudFormation format', () => {
      expect(() => testTemplateStructure(template)).not.toThrow();
    });

    and('the template should have required sections including Globals', () => {
      expect(() => testRequiredSections(template, true)).not.toThrow();
    });
  });

  test('Template has required parameters', ({ given, then, and }) => {
    loadTemplate(given);

    then(
      'the template should have Environment parameter with allowed values',
      () => {
        expect(() => testEnvironmentParameter(template)).not.toThrow();
      },
    );

    and(
      'the template should have required parameters:',
      (table: { parameter: string }[]) => {
        const params = table.map((row) => row.parameter);
        expect(() => testRequiredParameters(template, params)).not.toThrow();
      },
    );

    and(
      /^the CsrRetentionDays parameter should have default value of (\d+)$/,
      (value: string) => {
        const param = template.Parameters.CsrRetentionDays as Record<
          string,
          unknown
        >;
        expect(param).toBeDefined();
        expect(param.Default).toBe(parseInt(value));
      },
    );
  });
});

const defineBucketFeature = (feature: ReturnType<typeof loadFeature>) => {
  defineFeature(feature, (test) => {
    test('S3 bucket has correct configuration', ({ given, then, and }) => {
      loadTemplate(given);
      let bucket: Record<string, unknown>;
      let properties: Record<string, unknown>;

      then(
        /^the "([^"]+)" bucket should exist with type "([^"]+)"$/,
        (name: string, type: string) => {
          bucket = template.Resources[name] as Record<string, unknown>;
          properties = bucket.Properties as Record<string, unknown>;
          expect(bucket).toBeDefined();
          expect(bucket.Type).toBe(type);
        },
      );

      and(
        /^the "([^"]+)" bucket should have Retain deletion and update replace policies$/,
        () => {
          expect(bucket.DeletionPolicy).toBe('Retain');
          expect(bucket.UpdateReplacePolicy).toBe('Retain');
        },
      );

      and(
        /^the "([^"]+)" bucket should have all public access blocked$/,
        () => {
          const publicAccessBlock =
            properties.PublicAccessBlockConfiguration as Record<
              string,
              unknown
            >;
          expect(publicAccessBlock.BlockPublicAcls).toBe(true);
          expect(publicAccessBlock.BlockPublicPolicy).toBe(true);
          expect(publicAccessBlock.IgnorePublicAcls).toBe(true);
          expect(publicAccessBlock.RestrictPublicBuckets).toBe(true);
        },
      );

      and(
        /^the "([^"]+)" bucket should have SSE-KMS encryption with key "([^"]+)"$/,
        (_: string, kmsKey: string) => {
          const encryption = properties.BucketEncryption as Record<
            string,
            unknown
          >;
          const rules = encryption.ServerSideEncryptionConfiguration as Record<
            string,
            unknown
          >[];
          const rule = rules[0];
          const defaults = rule.ServerSideEncryptionByDefault as Record<
            string,
            unknown
          >;
          expect(defaults.SSEAlgorithm).toBe('aws:kms');
          expect(defaults.KMSMasterKeyID).toEqual({ Ref: kmsKey });
          expect(rule.BucketKeyEnabled).toBe(true);
        },
      );

      and(/^the "([^"]+)" bucket should have versioning enabled$/, () => {
        const versioning = properties.VersioningConfiguration as Record<
          string,
          unknown
        >;
        expect(versioning.Status).toBe('Enabled');
      });

      and(
        /^the "([^"]+)" bucket should have lifecycle rule using CsrRetentionDays$/,
        () => {
          const lifecycle = properties.LifecycleConfiguration as Record<
            string,
            unknown
          >;
          const rules = lifecycle.Rules as Record<string, unknown>[];
          expect(rules).toHaveLength(1);
          expect(rules[0].Id).toBe('CsrRetentionPolicy');
          expect(rules[0].Status).toBe('Enabled');
          expect(rules[0].ExpirationInDays).toEqual({
            Ref: 'CsrRetentionDays',
          });
        },
      );

      and(
        /^the "([^"]+)" bucket should have access logging configured$/,
        () => {
          const logging = properties.LoggingConfiguration as Record<
            string,
            unknown
          >;
          expect(logging.DestinationBucketName).toBeDefined();
          expect(logging.LogFilePrefix).toBe('s3-access-logs/');
        },
      );
    });

    test('KMS key has correct configuration', ({ given, then, and }) => {
      loadTemplate(given);
      let keyName: string;
      let key: Record<string, unknown>;
      let properties: Record<string, unknown>;

      then(
        /^the "([^"]+)" KMS key should exist with type "([^"]+)"$/,
        (name: string, type: string) => {
          keyName = name;
          key = template.Resources[keyName] as Record<string, unknown>;
          properties = key.Properties as Record<string, unknown>;
          expect(key).toBeDefined();
          expect(key.Type).toBe(type);
        },
      );

      and(/^the "([^"]+)" KMS key should have key rotation enabled$/, () => {
        expect(properties.EnableKeyRotation).toBe(true);
      });

      and(
        /^the "([^"]+)" KMS key should have an alias "([^"]+)"$/,
        (_: string, aliasName: string) => {
          const alias = template.Resources[aliasName] as Record<
            string,
            unknown
          >;
          expect(alias).toBeDefined();
          expect(alias.Type).toBe('AWS::KMS::Alias');
          const aliasProps = alias.Properties as Record<string, unknown>;
          expect(aliasProps.TargetKeyId).toEqual({ Ref: keyName });
        },
      );
    });
  });
};

defineBucketFeature(receivedBucketFeature);
defineBucketFeature(validatedBucketFeature);
