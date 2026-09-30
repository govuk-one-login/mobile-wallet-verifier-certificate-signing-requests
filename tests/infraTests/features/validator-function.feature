Feature: CsrValidatorFunction Infrastructure

  Background:
    Given the CloudFormation template is loaded

  Scenario: Validator resources are only created in dev, build and integration
    Then the "CreateValidator" condition should be true only for environments:
      | environment |
      | dev         |
      | build       |
      | integration |
    And the following resources should carry the "CreateValidator" condition:
      | resource                     |
      | CsrValidatorFunction         |
      | CsrValidatorFunctionRole     |
      | CsrValidatorFunctionLogGroup |

  Scenario: Gradual rollout uses a bounded CodeDeploy role
    Then the Globals deployment preference should use the "Linear20PercentEvery1Minute" deployment config in integration and prod
    And the "Linear20PercentEvery1Minute" deployment config should shift 20 percent every 1 minute
    And the Globals deployment preference role should be "CodeDeployServiceRole"
    And the "CodeDeployServiceRole" role should have no condition and carry the permissions boundary

  Scenario: Function logs to its managed log group
    Then the "CsrValidatorFunction" function should log to "CsrValidatorFunctionLogGroup"

  Scenario: Every function is code signed
    Then every "AWS::Serverless::Function" should set CodeSigningConfigArn under the "UseCodeSigning" condition
