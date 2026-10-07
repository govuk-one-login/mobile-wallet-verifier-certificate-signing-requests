Feature: CsrValidatorFunction Infrastructure

  Background:
    Given the CloudFormation template is loaded

  Scenario: Function logs to its managed log group
    Then the "CsrValidatorFunction" function should log to "CsrValidatorFunctionLogGroup"

  Scenario: Every function is code signed
    Then every "AWS::Serverless::Function" should set CodeSigningConfigArn under the "UseCodeSigning" condition

  Scenario: Function receives the validated bucket name via environment variable
    Then the "CsrValidatorFunction" function should set environment variable "CSR_VALIDATED_BUCKET" to Ref "CsrValidatedBucket"

  Scenario: Function role can read received CSRs and write validated CSRs
    Then the "CsrValidatorFunctionRole" role should allow "s3:GetObject" on the "csr-received" bucket objects
    And the "CsrValidatorFunctionRole" role should allow "s3:GetObjectVersion" on the "csr-received" bucket objects
    And the "CsrValidatorFunctionRole" role should allow "s3:PutObject" on the "csr-validated" bucket objects
    And the "CsrValidatorFunctionRole" role should allow "kms:Decrypt" on key "CsrReceivedBucketKmsKey"
    And the "CsrValidatorFunctionRole" role should allow "kms:GenerateDataKey" on key "CsrValidatedBucketKmsKey"

  Scenario: Received bucket triggers the validator function on object creation
    Then the "CsrReceivedBucket" bucket should notify the "CsrValidatorFunction" alias on "s3:ObjectCreated:*"
    And the "CsrReceivedBucket" notification for "s3:ObjectCreated:*" should filter on prefix "incoming/"
    And S3 should be permitted to invoke the "CsrValidatorFunction" alias from the "csr-received" bucket
