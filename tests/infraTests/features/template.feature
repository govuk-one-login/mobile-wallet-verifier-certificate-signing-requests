Feature: CloudFormation Template Infrastructure

  Background:
    Given the CloudFormation template is loaded

  Scenario: Template has valid structure
    Then the template should have valid CloudFormation format
    And the template should have required sections including Globals

  Scenario: Template has required parameters
    Then the template should have Environment parameter with allowed values
    And the template should have required parameters:
      | parameter            |
      | Environment          |
      | CodeSigningConfigArn |
      | PermissionsBoundary  |
      | VpcStackName         |
    And the CsrRetentionDays parameter should have default value of 366


