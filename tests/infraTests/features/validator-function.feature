Feature: CsrValidatorFunction Infrastructure

  Background:
    Given the CloudFormation template is loaded

  Scenario: Function logs to its managed log group
    Then the "CsrValidatorFunction" function should log to "CsrValidatorFunctionLogGroup"

  Scenario: Every function is code signed
    Then every "AWS::Serverless::Function" should set CodeSigningConfigArn under the "UseCodeSigning" condition
