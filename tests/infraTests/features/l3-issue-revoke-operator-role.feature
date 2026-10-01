Feature: L3IssueRevokeOperatorRole Infrastructure

  Background:
    Given the CloudFormation template is loaded

  Scenario: IAM role has correct configuration
    Then the "L3IssueRevokeOperatorRole" role should exist with type "AWS::IAM::Role"
    And the "L3IssueRevokeOperatorRole" role should allow sts:AssumeRole from account root
    And the "L3IssueRevokeOperatorRole" role should have permissions boundary applied

  Scenario: IAM role has correct S3 policies
    Then the "L3IssueRevokeOperatorRole" role should have policy "L3IssueRevokeOperatorS3AccessValidatedBucket" with actions:
      | action       |
      | s3:GetObject  |
      | s3:ListBucket |
    And the "L3IssueRevokeOperatorRole" role should have policy "L3IssueRevokeOperatorS3AccessIssuedCertsBucketGet" with actions:
      | action      |
      | s3:GetObject |
    And the "L3IssueRevokeOperatorRole" role should have policy "L3IssueRevokeOperatorS3AccessIssuedCertsBucketList" with actions:
      | action      |
      | s3:ListBucket |

  Scenario: IAM role has correct KMS policies
    Then the "L3IssueRevokeOperatorRole" role should have policy "L3IssueRevokeOperatorAccessValidatedBucket" with actions:
      | action     |
      | kms:Decrypt |

  Scenario: IAM role trust policy contains the correct SSO principal
    Then the "L3IssueRevokeOperatorRole" trust policy should contain SSO principal matching "AWSReservedSSO_ApprovedMobWalletCAIssueRevoke"
    And the "L3IssueRevokeOperatorRole" trust policy should not contain SSO principal matching "AWSReservedSSO_ApprovedMobWalletCAEnableDisable"
