import { loadFeature, defineFeature } from 'jest-cucumber';
import { join } from 'path';
import { expect } from 'vitest';
import {
  CloudFormationTemplate,
  loadCloudFormationTemplate,
  testTemplateStructure,
  testRequiredSections,
  testEnvironmentParameter,
  testRequiredParameters,
  ENVIRONMENT_VALUES,
} from './shared-helpers/cfn-test-utils.js';

const templateFeature = loadFeature(
  join(__dirname, '../features/template.feature'),
);
const receivedBucketFeature = loadFeature(
  join(__dirname, '../features/received-bucket.feature'),
);
const validatedBucketFeature = loadFeature(
  join(__dirname, '../features/validated-bucket.feature'),
);
const validatorFunctionFeature = loadFeature(
  join(__dirname, '../features/validator-function.feature'),
);
const l3OperatorRolesFeature = loadFeature(
  join(__dirname, '../features/l3-operator-roles.feature'),
);

let template: CloudFormationTemplate;

interface S3KeyFilterRule {
  Name: string;
  Value: string;
}

interface LambdaNotificationConfig {
  Event: string;
  Function: unknown;
  Filter?: { S3Key?: { Rules?: S3KeyFilterRule[] } };
}

const getLambdaNotificationConfig = (
  bucketName: string,
  event: string,
): LambdaNotificationConfig => {
  const bucket = template.Resources[bucketName] as
    | { Properties?: { NotificationConfiguration?: unknown } }
    | undefined;
  expect(bucket, `no bucket resource ${bucketName}`).toBeDefined();

  const notification = bucket!.Properties?.NotificationConfiguration as
    | { LambdaConfigurations?: LambdaNotificationConfig[] }
    | undefined;
  const lambdaConfigs = notification?.LambdaConfigurations;
  expect(
    lambdaConfigs,
    `no LambdaConfigurations on ${bucketName}`,
  ).toBeDefined();

  const config = lambdaConfigs!.find((entry) => entry.Event === event);
  expect(config, `no notification for event ${event}`).toBeDefined();
  return config!;
};

const loadTemplate = (given: (s: string, fn: () => void) => void) => {
  given('the CloudFormation template is loaded', () => {
    template = loadCloudFormationTemplate(
      join(__dirname, '../../../template.yaml'),
    );
  });
};

defineFeature(templateFeature, (test) => {
  test('Template has valid structure', ({ given, then, and }) => {
    loadTemplate(given);

    then('the template should have valid CloudFormation format', () => {
      expect(() => testTemplateStructure(template)).not.toThrow();
      expect(template.AWSTemplateFormatVersion).toBe('2010-09-09');
      expect(template.Transform).toBe('AWS::Serverless-2016-10-31');
    });

    and('the template should have required sections including Globals', () => {
      expect(() => testRequiredSections(template, true)).not.toThrow();
      expect(template.Parameters).toBeDefined();
      expect(template.Resources).toBeDefined();
      expect(template.Outputs).toBeDefined();
      expect(template.Globals).toBeDefined();
    });
  });

  test('Template has required parameters', ({ given, then, and }) => {
    loadTemplate(given);

    then(
      'the template should have Environment parameter with allowed values',
      () => {
        expect(() => testEnvironmentParameter(template)).not.toThrow();
        const envParam = template.Parameters.Environment as Record<
          string,
          unknown
        >;
        expect(envParam.Type).toBe('String');
        expect(envParam.AllowedValues).toEqual(ENVIRONMENT_VALUES);
      },
    );

    and(
      'the template should have required parameters:',
      (table: { parameter: string }[]) => {
        const params = table.map((row) => row.parameter);
        expect(() => testRequiredParameters(template, params)).not.toThrow();
        for (const param of params) {
          expect(template.Parameters[param], `${param} missing`).toBeDefined();
        }
      },
    );

    and(
      /^the CsrRetentionDays parameter should have default value of (\d+)$/,
      (value: string) => {
        const param = template.Parameters.CsrRetentionDays as Record<
          string,
          unknown
        >;
        expect(param).toBeDefined();
        expect(param.Default).toBe(parseInt(value));
      },
    );
  });
});

const defineBucketFeature = (feature: ReturnType<typeof loadFeature>) => {
  defineFeature(feature, (test) => {
    test('S3 bucket has correct configuration', ({ given, then, and }) => {
      loadTemplate(given);
      let bucket: Record<string, unknown>;
      let properties: Record<string, unknown>;

      then(
        /^the "([^"]+)" bucket should exist with type "([^"]+)"$/,
        (name: string, type: string) => {
          bucket = template.Resources[name] as Record<string, unknown>;
          properties = bucket.Properties as Record<string, unknown>;
          expect(bucket).toBeDefined();
          expect(bucket.Type).toBe(type);
        },
      );

      and(
        /^the "([^"]+)" bucket should have Retain deletion and update replace policies$/,
        () => {
          expect(bucket.DeletionPolicy).toBe('Retain');
          expect(bucket.UpdateReplacePolicy).toBe('Retain');
        },
      );

      and(
        /^the "([^"]+)" bucket should have all public access blocked$/,
        () => {
          const publicAccessBlock =
            properties.PublicAccessBlockConfiguration as Record<
              string,
              unknown
            >;
          expect(publicAccessBlock.BlockPublicAcls).toBe(true);
          expect(publicAccessBlock.BlockPublicPolicy).toBe(true);
          expect(publicAccessBlock.IgnorePublicAcls).toBe(true);
          expect(publicAccessBlock.RestrictPublicBuckets).toBe(true);
        },
      );

      and(
        /^the "([^"]+)" bucket should have SSE-KMS encryption with key "([^"]+)"$/,
        (_: string, kmsKey: string) => {
          const encryption = properties.BucketEncryption as Record<
            string,
            unknown
          >;
          const rules = encryption.ServerSideEncryptionConfiguration as Record<
            string,
            unknown
          >[];
          const rule = rules[0];
          const defaults = rule.ServerSideEncryptionByDefault as Record<
            string,
            unknown
          >;
          expect(defaults.SSEAlgorithm).toBe('aws:kms');
          expect(defaults.KMSMasterKeyID).toEqual({ Ref: kmsKey });
          expect(rule.BucketKeyEnabled).toBe(true);
        },
      );

      and(/^the "([^"]+)" bucket should have versioning enabled$/, () => {
        const versioning = properties.VersioningConfiguration as Record<
          string,
          unknown
        >;
        expect(versioning.Status).toBe('Enabled');
      });

      and(
        /^the "([^"]+)" bucket should have lifecycle rule using CsrRetentionDays$/,
        () => {
          const lifecycle = properties.LifecycleConfiguration as Record<
            string,
            unknown
          >;
          const rules = lifecycle.Rules as Record<string, unknown>[];
          expect(rules).toHaveLength(1);
          expect(rules[0].Id).toBe('CsrRetentionPolicy');
          expect(rules[0].Status).toBe('Enabled');
          expect(rules[0].ExpirationInDays).toEqual({
            Ref: 'CsrRetentionDays',
          });
        },
      );

      and(
        /^the "([^"]+)" bucket should have access logging configured$/,
        () => {
          const logging = properties.LoggingConfiguration as Record<
            string,
            unknown
          >;
          expect(logging.DestinationBucketName).toBeDefined();
          expect(logging.LogFilePrefix).toBe('s3-access-logs/');
        },
      );
    });

    test('KMS key has correct configuration', ({ given, then, and }) => {
      loadTemplate(given);
      let keyName: string;
      let key: Record<string, unknown>;
      let properties: Record<string, unknown>;

      then(
        /^the "([^"]+)" KMS key should exist with type "([^"]+)"$/,
        (name: string, type: string) => {
          keyName = name;
          key = template.Resources[keyName] as Record<string, unknown>;
          properties = key.Properties as Record<string, unknown>;
          expect(key).toBeDefined();
          expect(key.Type).toBe(type);
        },
      );

      and(/^the "([^"]+)" KMS key should have key rotation enabled$/, () => {
        expect(properties.EnableKeyRotation).toBe(true);
      });

      and(
        /^the "([^"]+)" KMS key should have an alias "([^"]+)"$/,
        (_: string, aliasName: string) => {
          const alias = template.Resources[aliasName] as Record<
            string,
            unknown
          >;
          expect(alias).toBeDefined();
          expect(alias.Type).toBe('AWS::KMS::Alias');
          const aliasProps = alias.Properties as Record<string, unknown>;
          expect(aliasProps.TargetKeyId).toEqual({ Ref: keyName });
        },
      );
    });
  });
};

defineBucketFeature(receivedBucketFeature);
defineBucketFeature(validatedBucketFeature);

defineFeature(validatorFunctionFeature, (test) => {
  test('Function logs to its managed log group', ({ given, then }) => {
    loadTemplate(given);

    then(
      /^the "([^"]+)" function should log to "([^"]+)"$/,
      (functionName: string, logGroupName: string) => {
        const fn = template.Resources[functionName] as Record<string, unknown>;
        const loggingConfig = (fn.Properties as Record<string, unknown>)
          .LoggingConfig as Record<string, unknown>;
        expect(loggingConfig.LogGroup).toEqual({ Ref: logGroupName });
      },
    );
  });

  test('Every function is code signed', ({ given, then }) => {
    loadTemplate(given);

    then(
      /^every "([^"]+)" should set CodeSigningConfigArn under the "([^"]+)" condition$/,
      (resourceType: string, conditionName: string) => {
        const functions = Object.entries(template.Resources).filter(
          ([, resource]) =>
            (resource as Record<string, unknown>).Type === resourceType,
        );
        expect(functions.length).toBeGreaterThan(0);
        for (const [name, resource] of functions) {
          const properties = (resource as Record<string, unknown>)
            .Properties as Record<string, unknown>;
          expect(properties.CodeSigningConfigArn, name).toEqual({
            'Fn::If': [
              conditionName,
              { Ref: 'CodeSigningConfigArn' },
              { Ref: 'AWS::NoValue' },
            ],
          });
        }
      },
    );
  });

  test('Function receives the validated bucket name via environment variable', ({
    given,
    then,
  }) => {
    loadTemplate(given);

    then(
      /^the "([^"]+)" function should set environment variable "([^"]+)" to Ref "([^"]+)"$/,
      (functionName: string, envVar: string, refTarget: string) => {
        const fn = template.Resources[functionName] as Record<string, unknown>;
        const environment = (fn.Properties as Record<string, unknown>)
          .Environment as Record<string, unknown>;
        const variables = environment.Variables as Record<string, unknown>;
        expect(variables[envVar]).toEqual({ Ref: refTarget });
      },
    );
  });

  test('Function role can read received CSRs and write validated CSRs', ({
    given,
    then,
    and,
  }) => {
    loadTemplate(given);

    const findStatementAction = (
      roleName: string,
      action: string,
    ): Record<string, unknown> => {
      const role = template.Resources[roleName] as Record<string, unknown>;
      const policies = (role.Properties as Record<string, unknown>)
        .Policies as Record<string, unknown>[];
      const statements = policies.flatMap((policy) => {
        const document = policy.PolicyDocument as Record<string, unknown>;
        return document.Statement as Record<string, unknown>[];
      });
      const match = statements.find((statement) => {
        const statementAction = statement.Action;
        return Array.isArray(statementAction)
          ? statementAction.includes(action)
          : statementAction === action;
      });
      expect(match, `no statement found for action ${action}`).toBeDefined();
      return match as Record<string, unknown>;
    };

    const expectS3Statement = (
      roleName: string,
      action: string,
      bucketSuffix: string,
    ) => {
      const statement = findStatementAction(roleName, action);
      expect(statement.Effect).toBe('Allow');
      const resource = statement.Resource as Record<string, string>;
      expect(resource['Fn::Sub']).toBe(
        `arn:aws:s3:::\${AWS::AccountId}-\${AWS::StackName}-${bucketSuffix}/*`,
      );
    };

    const expectKmsStatement = (
      roleName: string,
      action: string,
      keyName: string,
    ) => {
      const statement = findStatementAction(roleName, action);
      expect(statement.Effect).toBe('Allow');
      expect(statement.Resource).toEqual({ 'Fn::GetAtt': `${keyName}.Arn` });
    };

    const s3Step =
      /^the "([^"]+)" role should allow "([^"]+)" on the "([^"]+)" bucket objects$/;
    const kmsStep =
      /^the "([^"]+)" role should allow "([^"]+)" on key "([^"]+)"$/;

    then(s3Step, expectS3Statement);
    and(s3Step, expectS3Statement);
    and(s3Step, expectS3Statement);
    and(kmsStep, expectKmsStatement);
    and(kmsStep, expectKmsStatement);
  });

  test('Received bucket triggers the validator function on object creation', ({
    given,
    then,
    and,
  }) => {
    loadTemplate(given);

    then(
      /^the "([^"]+)" bucket should notify the "([^"]+)" alias on "([^"]+)"$/,
      (bucketName: string, functionName: string, event: string) => {
        const config = getLambdaNotificationConfig(bucketName, event);
        expect(config.Function).toEqual({ Ref: `${functionName}.Alias` });
      },
    );

    and(
      /^the "([^"]+)" notification for "([^"]+)" should filter on prefix "([^"]+)"$/,
      (bucketName: string, event: string, prefix: string) => {
        const config = getLambdaNotificationConfig(bucketName, event);
        const rules = config.Filter?.S3Key?.Rules;
        expect(
          rules,
          `no S3Key filter rules on ${bucketName} notification for ${event}`,
        ).toBeDefined();
        expect(rules).toContainEqual({ Name: 'prefix', Value: prefix });
      },
    );

    and(
      /^S3 should be permitted to invoke the "([^"]+)" alias from the "([^"]+)" bucket$/,
      (functionName: string, bucketSuffix: string) => {
        const permission = Object.values(template.Resources).find(
          (resource) => {
            const typed = resource as Record<string, unknown>;
            if (typed.Type !== 'AWS::Lambda::Permission') return false;
            const props = typed.Properties as Record<string, unknown>;
            return (
              props.Principal === 's3.amazonaws.com' &&
              JSON.stringify(props.FunctionName) ===
                JSON.stringify({ Ref: `${functionName}.Alias` })
            );
          },
        ) as Record<string, unknown> | undefined;
        expect(permission, 'no S3 invoke permission found').toBeDefined();
        const props = permission!.Properties as Record<string, unknown>;
        expect(props.Action).toBe('lambda:InvokeFunction');
        expect(props.SourceAccount).toEqual({ Ref: 'AWS::AccountId' });
        const sourceArn = props.SourceArn as Record<string, string>;
        expect(sourceArn['Fn::Sub']).toBe(
          `arn:aws:s3:::\${AWS::AccountId}-\${AWS::StackName}-${bucketSuffix}`,
        );
      },
    );
  });
});

defineFeature(l3OperatorRolesFeature, (test) => {
  const roleOf = (roleName: string): Record<string, unknown> => {
    const role = template.Resources[roleName] as Record<string, unknown>;
    expect(role, `role ${roleName} not found`).toBeDefined();
    return role.Properties as Record<string, unknown>;
  };

  const policiesOf = (roleName: string): Record<string, unknown>[] =>
    roleOf(roleName).Policies as Record<string, unknown>[];

  const expectRoleExists = (roleName: string) => {
    const role = template.Resources[roleName] as Record<string, unknown>;
    expect(role, `role ${roleName} not found`).toBeDefined();
    expect(role.Type).toBe('AWS::IAM::Role');
  };

  const expectPermissionsBoundary = (roleName: string) => {
    const props = roleOf(roleName);
    expect(props.PermissionsBoundary).toEqual({
      'Fn::If': [
        'UsePermissionsBoundary',
        { Ref: 'PermissionsBoundary' },
        { Ref: 'AWS::NoValue' },
      ],
    });
  };

  const expectAssumableBySso = (roleName: string, permissionSet: string) => {
    const props = roleOf(roleName);
    const doc = props.AssumeRolePolicyDocument as Record<string, unknown>;
    const statements = doc.Statement as Record<string, unknown>[];
    const condition = statements[0]!.Condition as Record<string, unknown>;
    const arnLike = condition.ArnLike as Record<string, unknown>;
    const principals = arnLike['aws:PrincipalARN'] as Record<string, string>[];
    const matched = principals.some((p) =>
      (p['Fn::Sub'] ?? '').includes(permissionSet),
    );
    expect(matched, `${roleName} is not assumable by ${permissionSet}`).toBe(
      true,
    );
  };

  const expectPolicyNamePrefix = (roleName: string, prefix: string) => {
    const policies = policiesOf(roleName);
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy.PolicyName as string).toMatch(new RegExp(`^${prefix}`));
    }
  };

  test('EnableDisable operator role is defined with the expected trust and permissions', ({
    given,
    then,
    and,
  }) => {
    loadTemplate(given);
    then(/^the "([^"]+)" role should exist as an IAM role$/, expectRoleExists);
    and(
      /^the "([^"]+)" role should carry the permissions boundary$/,
      expectPermissionsBoundary,
    );
    and(
      /^the "([^"]+)" role should be assumable only by the "([^"]+)" permission set$/,
      expectAssumableBySso,
    );
    and(
      /^the "([^"]+)" role should name every inline policy with the "([^"]+)" prefix$/,
      expectPolicyNamePrefix,
    );
  });

  test('IssueRevoke operator role is defined with the expected trust and permissions', ({
    given,
    then,
    and,
  }) => {
    loadTemplate(given);
    then(/^the "([^"]+)" role should exist as an IAM role$/, expectRoleExists);
    and(
      /^the "([^"]+)" role should carry the permissions boundary$/,
      expectPermissionsBoundary,
    );
    and(
      /^the "([^"]+)" role should be assumable only by the "([^"]+)" permission set$/,
      expectAssumableBySso,
    );
    and(
      /^the "([^"]+)" role should name every inline policy with the "([^"]+)" prefix$/,
      expectPolicyNamePrefix,
    );
  });

  test('IssueRevoke operator can write issued certificates to the Int CA backend bucket', ({
    given,
    then,
  }) => {
    loadTemplate(given);
    then(
      /^the "([^"]+)" role should allow "([^"]+)" on the imported "([^"]+)" under the "([^"]+)" prefix$/,
      (
        roleName: string,
        action: string,
        importSuffix: string,
        prefix: string,
      ) => {
        const policies = policiesOf(roleName);
        const statements = policies.flatMap((policy) => {
          const document = policy.PolicyDocument as Record<string, unknown>;
          return document.Statement as Record<string, unknown>[];
        });
        const match = statements.find((statement) => {
          const act = statement.Action;
          const hasAction = Array.isArray(act)
            ? act.includes(action)
            : act === action;
          if (!hasAction) return false;
          const resource = statement.Resource as Record<string, unknown>;
          const sub = resource['Fn::Sub'] as unknown[] | undefined;
          return (
            Array.isArray(sub) &&
            typeof sub[0] === 'string' &&
            (sub[0] as string).includes(`/${prefix}`)
          );
        });
        expect(
          match,
          `no ${action} statement scoped to ${prefix} found on ${roleName}`,
        ).toBeDefined();
        const resource = (match!.Resource as Record<string, unknown>)[
          'Fn::Sub'
        ] as unknown[];
        const vars = resource[1] as Record<string, unknown>;
        const bucketName = vars.BucketName as Record<string, unknown>;
        const importValue = bucketName['Fn::ImportValue'] as Record<
          string,
          unknown
        >;
        expect(JSON.stringify(importValue)).toContain(importSuffix);
      },
    );
  });
});
