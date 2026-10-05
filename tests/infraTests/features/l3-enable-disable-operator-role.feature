Feature: L3EnableDisableOperatorRole Infrastructure

  Background:
    Given the CloudFormation template is loaded

  Scenario: IAM role has correct configuration
    Then the "L3EnableDisableOperatorRole" role should exist with type "AWS::IAM::Role"
    And the "L3EnableDisableOperatorRole" role should allow sts:AssumeRole from account root
    And the "L3EnableDisableOperatorRole" role should have permissions boundary applied

  Scenario: IAM role has correct S3 policies
    Then the "L3EnableDisableOperatorRole" role should have policy "L3EnableDisableOperatorS3AccessReceivedBucket" with actions:
      | action      |
      | s3:PutObject |

  Scenario: IAM role has correct KMS policies
    Then the "L3EnableDisableOperatorRole" role should have policy "L3EnableDisableOperatorKMSAccessReceivedBucket" with actions:
      | action               |
      | kms:Encrypt           |
      | kms:GenerateDataKey   |
    And the "L3EnableDisableOperatorRole" role should have policy "L3EnableDisableOperatorAccessValidatedBucket" with actions:
      | action     |
      | kms:Decrypt |

  Scenario: IAM role trust policy contains the correct SSO principal
    Then the "L3EnableDisableOperatorRole" trust policy should contain SSO principal matching "AWSReservedSSO_ApprovedMobWalletCAEnableDisable"
    And the "L3EnableDisableOperatorRole" trust policy should not contain SSO principal matching "AWSReservedSSO_ApprovedMobWalletCAIssueRevoke"
