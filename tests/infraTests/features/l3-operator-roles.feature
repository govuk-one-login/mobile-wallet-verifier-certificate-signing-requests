Feature: L3 operator IAM roles

  Background:
    Given the CloudFormation template is loaded

  Scenario: EnableDisable operator role is defined with the expected trust and permissions
    Then the "L3EnableDisableOperatorRole" role should exist as an IAM role
    And the "L3EnableDisableOperatorRole" role should carry the permissions boundary
    And the "L3EnableDisableOperatorRole" role should be assumable only by the "AWSReservedSSO_ApprovedMobWalletCAEnableDisable" permission set
    And the "L3EnableDisableOperatorRole" role should name every inline policy with the "L3EnableDisableOperator" prefix

  Scenario: IssueRevoke operator role is defined with the expected trust and permissions
    Then the "L3IssueRevokeOperatorRole" role should exist as an IAM role
    And the "L3IssueRevokeOperatorRole" role should carry the permissions boundary
    And the "L3IssueRevokeOperatorRole" role should be assumable only by the "AWSReservedSSO_ApprovedMobWalletCAIssueRevoke" permission set
    And the "L3IssueRevokeOperatorRole" role should name every inline policy with the "L3IssueRevokeOperator" prefix

  Scenario: IssueRevoke operator can write issued certificates to the Int CA backend bucket
    Then the "L3IssueRevokeOperatorRole" role should allow "s3:PutObject" on the imported "IssuedCertsBucketName" under the "issued/" prefix
