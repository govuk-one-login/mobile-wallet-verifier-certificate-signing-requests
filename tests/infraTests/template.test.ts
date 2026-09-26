import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import {
  CloudFormationTemplate,
  loadCloudFormationTemplate,
  testTemplateStructure,
  testRequiredSections,
  testEnvironmentParameter,
  testRequiredParameters,
  // testRequiredOutputs,
} from './cfn-test-utils';

describe('Application Infrastructure', () => {
  let template: CloudFormationTemplate;

  beforeAll(() => {
    const templatePath = join(__dirname, '../../template.yaml');
    template = loadCloudFormationTemplate(templatePath);
  });

  describe('Template Structure', () => {
    it('should have valid CloudFormation format', () => {
      expect(() => testTemplateStructure(template)).not.toThrow();
    });

    it('should have required sections', () => {
      expect(() => testRequiredSections(template, true)).not.toThrow();
    });
  });

  describe('Parameters', () => {
    it('should have Environment parameter', () => {
      expect(() => testEnvironmentParameter(template)).not.toThrow();
    });

    it('should have all required parameters', () => {
      expect(() =>
        testRequiredParameters(template, [
          'Environment',
          'CodeSigningConfigArn',
          'PermissionsBoundary',
          'VpcStackName',
        ]),
      ).not.toThrow();
    });

    it('should have CsrRetentionDays parameter with default value of 366', () => {
      const param = template.Parameters.CsrRetentionDays as Record<
        string,
        unknown
      >;
      expect(param).toBeDefined();
      expect(param.Default).toBe(366);
    });
  });

  describe('CsrReceived Bucket', () => {
    let bucket: Record<string, unknown>;
    let properties: Record<string, unknown>;

    beforeAll(() => {
      bucket = template.Resources.CsrReceivedBucket as Record<string, unknown>;
      properties = bucket.Properties as Record<string, unknown>;
    });

    it('should exist and be of correct type', () => {
      expect(bucket).toBeDefined();
      expect(bucket.Type).toBe('AWS::S3::Bucket');
    });

    it('should have Retain deletion and update replace policies', () => {
      expect(bucket.DeletionPolicy).toBe('Retain');
      expect(bucket.UpdateReplacePolicy).toBe('Retain');
    });

    it('should have all public access blocked', () => {
      const publicAccessBlock =
        properties.PublicAccessBlockConfiguration as Record<string, unknown>;
      expect(publicAccessBlock.BlockPublicAcls).toBe(true);
      expect(publicAccessBlock.BlockPublicPolicy).toBe(true);
      expect(publicAccessBlock.IgnorePublicAcls).toBe(true);
      expect(publicAccessBlock.RestrictPublicBuckets).toBe(true);
    });

    it('should have AES256 server-side encryption', () => {
      const encryption = properties.BucketEncryption as Record<string, unknown>;
      const rules = encryption.ServerSideEncryptionConfiguration as Record<
        string,
        unknown
      >[];
      const rule = rules[0].ServerSideEncryptionByDefault as Record<
        string,
        unknown
      >;
      expect(rule.SSEAlgorithm).toBe('AES256');
    });

    it('should have versioning enabled', () => {
      const versioning = properties.VersioningConfiguration as Record<
        string,
        unknown
      >;
      expect(versioning.Status).toBe('Enabled');
    });

    it('should have a lifecycle rule using CsrRetentionDays parameter', () => {
      const lifecycle = properties.LifecycleConfiguration as Record<
        string,
        unknown
      >;
      const rules = lifecycle.Rules as Record<string, unknown>[];
      expect(rules).toHaveLength(1);
      expect(rules[0].Id).toBe('CsrRetentionPolicy');
      expect(rules[0].Status).toBe('Enabled');
      expect(rules[0].ExpirationInDays).toEqual({ Ref: 'CsrRetentionDays' });
    });

    it('should have access logging configured', () => {
      const logging = properties.LoggingConfiguration as Record<
        string,
        unknown
      >;
      expect(logging.DestinationBucketName).toBeDefined();
      expect(logging.LogFilePrefix).toBe('s3-access-logs/');
    });
  });
});
