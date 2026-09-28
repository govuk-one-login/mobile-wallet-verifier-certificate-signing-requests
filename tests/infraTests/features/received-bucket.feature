Feature: CsrReceivedBucket Infrastructure

  Background:
    Given the CloudFormation template is loaded

  Scenario: S3 bucket has correct configuration
    Then the "CsrReceivedBucket" bucket should exist with type "AWS::S3::Bucket"
    And the "CsrReceivedBucket" bucket should have Retain deletion and update replace policies
    And the "CsrReceivedBucket" bucket should have all public access blocked
    And the "CsrReceivedBucket" bucket should have SSE-KMS encryption with key "CsrReceivedBucketKmsKey"
    And the "CsrReceivedBucket" bucket should have versioning enabled
    And the "CsrReceivedBucket" bucket should have lifecycle rule using CsrRetentionDays
    And the "CsrReceivedBucket" bucket should have access logging configured

  Scenario: KMS key has correct configuration
    Then the "CsrReceivedBucketKmsKey" KMS key should exist with type "AWS::KMS::Key"
    And the "CsrReceivedBucketKmsKey" KMS key should have key rotation enabled
    And the "CsrReceivedBucketKmsKey" KMS key should have an alias "CsrReceivedBucketKmsKeyAlias"
