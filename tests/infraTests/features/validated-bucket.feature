Feature: CsrValidatedBucket Infrastructure

  Background:
    Given the CloudFormation template is loaded

  Scenario: S3 bucket has correct configuration
    Then the "CsrValidatedBucket" bucket should exist with type "AWS::S3::Bucket"
    And the "CsrValidatedBucket" bucket should have Retain deletion and update replace policies
    And the "CsrValidatedBucket" bucket should have all public access blocked
    And the "CsrValidatedBucket" bucket should have SSE-KMS encryption with key "CsrValidatedBucketKmsKey"
    And the "CsrValidatedBucket" bucket should have versioning enabled
    And the "CsrValidatedBucket" bucket should have lifecycle rule using CsrRetentionDays
    And the "CsrValidatedBucket" bucket should have access logging configured

  Scenario: KMS key has correct configuration
    Then the "CsrValidatedBucketKmsKey" KMS key should exist with type "AWS::KMS::Key"
    And the "CsrValidatedBucketKmsKey" KMS key should have key rotation enabled
    And the "CsrValidatedBucketKmsKey" KMS key should have an alias "CsrValidatedBucketKmsKeyAlias"
