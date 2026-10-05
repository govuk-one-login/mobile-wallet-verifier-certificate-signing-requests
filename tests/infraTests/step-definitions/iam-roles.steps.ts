import { loadFeature, defineFeature } from 'jest-cucumber';
import { join } from 'path';
import { expect } from 'vitest';
import {
  CloudFormationTemplate,
  loadCloudFormationTemplate,
} from './shared-helpers/cfn-test-utils.js';

const l3EnableDisableFeature = loadFeature(
  join(__dirname, '../features/l3-enable-disable-operator-role.feature'),
);
const l3IssueRevokeFeature = loadFeature(
  join(__dirname, '../features/l3-issue-revoke-operator-role.feature'),
);

let template: CloudFormationTemplate;

const loadTemplate = (given: (s: string, fn: () => void) => void) => {
  given('the CloudFormation template is loaded', () => {
    template = loadCloudFormationTemplate(
      join(__dirname, '../../../template.yaml'),
    );
  });
};

const getPolicyActions = (
  role: Record<string, unknown>,
  policyName: string,
): string[] => {
  const properties = role.Properties as Record<string, unknown>;
  const policies = properties.Policies as Record<string, unknown>[];
  const policy = policies.find((p) => p.PolicyName === policyName);
  expect(policy).toBeDefined();
  const doc = policy!.PolicyDocument as Record<string, unknown>;
  const statements = doc.Statement as Record<string, unknown>[];
  return statements.flatMap((s) =>
    Array.isArray(s.Action) ? (s.Action as string[]) : [s.Action as string],
  );
};

const POLICY_ACTIONS_PATTERN =
  /^the "([^"]+)" role should have policy "([^"]+)" with actions:$/;

const assertRoleConfig = (
  then: (p: RegExp, fn: (name: string, type: string) => void) => void,
  and: (p: RegExp, fn: () => void) => void,
) => {
  let role: Record<string, unknown>;
  let properties: Record<string, unknown>;

  then(
    /^the "([^"]+)" role should exist with type "([^"]+)"$/,
    (name: string, type: string) => {
      role = template.Resources[name] as Record<string, unknown>;
      properties = role.Properties as Record<string, unknown>;
      expect(role).toBeDefined();
      expect(role.Type).toBe(type);
    },
  );

  and(
    /^the "([^"]+)" role should allow sts:AssumeRole from account root$/,
    () => {
      const doc = properties.AssumeRolePolicyDocument as Record<
        string,
        unknown
      >;
      const statements = doc.Statement as Record<string, unknown>[];
      expect(statements).toHaveLength(1);
      expect(statements[0].Effect).toBe('Allow');
      expect(statements[0].Action).toBe('sts:AssumeRole');
    },
  );

  and(/^the "([^"]+)" role should have permissions boundary applied$/, () => {
    const boundary = properties.PermissionsBoundary as Record<string, unknown>;
    const ifExpr = boundary['Fn::If'] as unknown[];
    expect(ifExpr[0]).toBe('UsePermissionsBoundary');
  });
};

const makePolicyAssertion = () => {
  let role: Record<string, unknown>;
  return (name: string, policyName: string, table: { action: string }[]) => {
    role = template.Resources[name] as Record<string, unknown>;
    const actions = getPolicyActions(role, policyName);
    table.forEach((row) => expect(actions).toContain(row.action));
  };
};

const getTrustPolicyPrincipalArns = (roleName: string): string[] => {
  const role = template.Resources[roleName] as Record<string, unknown>;
  const properties = role.Properties as Record<string, unknown>;
  const doc = properties.AssumeRolePolicyDocument as Record<string, unknown>;
  const statements = doc.Statement as Record<string, unknown>[];
  return statements.flatMap((s) => {
    const condition = s.Condition as Record<string, unknown> | undefined;
    const arnLike = condition?.ArnLike as Record<string, unknown> | undefined;
    const arns = arnLike?.['aws:PrincipalARN'];
    return Array.isArray(arns)
      ? (arns as string[])
      : arns
        ? [arns as string]
        : [];
  });
};

const SSO_PRINCIPAL_PATTERN =
  /^the "([^"]+)" trust policy should (contain|not contain) SSO principal matching "([^"]+)"$/;

const assertSsoPrincipal = (
  then: (
    p: RegExp,
    fn: (name: string, assertion: string, fragment: string) => void,
  ) => void,
  and: (
    p: RegExp,
    fn: (name: string, assertion: string, fragment: string) => void,
  ) => void,
) => {
  const check = (name: string, assertion: string, fragment: string) => {
    const arns = getTrustPolicyPrincipalArns(name);
    const matches = arns.some((arn) => {
      const str =
        typeof arn === 'string'
          ? arn
          : ((arn as Record<string, string>)['Fn::Sub'] ?? '');
      return str.includes(fragment);
    });
    if (assertion === 'contain') {
      expect(matches).toBe(true);
    } else {
      expect(matches).toBe(false);
    }
  };
  then(SSO_PRINCIPAL_PATTERN, check);
  and(SSO_PRINCIPAL_PATTERN, check);
};

defineFeature(l3EnableDisableFeature, (test) => {
  test('IAM role has correct configuration', ({ given, then, and }) => {
    loadTemplate(given);
    assertRoleConfig(then, and);
  });

  test('IAM role has correct S3 policies', ({ given, then }) => {
    loadTemplate(given);
    const assert = makePolicyAssertion();
    then(POLICY_ACTIONS_PATTERN, assert);
  });

  test('IAM role has correct S3 list policies', ({ given, then }) => {
    loadTemplate(given);
    const assert = makePolicyAssertion();
    then(POLICY_ACTIONS_PATTERN, assert);
  });

  test('IAM role has correct KMS policies', ({ given, then, and }) => {
    loadTemplate(given);
    const assert = makePolicyAssertion();
    then(POLICY_ACTIONS_PATTERN, assert);
    and(POLICY_ACTIONS_PATTERN, assert);
  });

  test('IAM role trust policy contains the correct SSO principal', ({
    given,
    then,
    and,
  }) => {
    loadTemplate(given);
    assertSsoPrincipal(then, and);
  });
});

defineFeature(l3IssueRevokeFeature, (test) => {
  test('IAM role has correct configuration', ({ given, then, and }) => {
    loadTemplate(given);
    assertRoleConfig(then, and);
  });

  test('IAM role has correct KMS policies', ({ given, then }) => {
    loadTemplate(given);
    const assert = makePolicyAssertion();
    then(POLICY_ACTIONS_PATTERN, assert);
  });

  test('IAM role has correct S3 policies', ({ given, then, and }) => {
    loadTemplate(given);
    const assert = makePolicyAssertion();
    then(POLICY_ACTIONS_PATTERN, assert);
    and(POLICY_ACTIONS_PATTERN, assert);
    and(POLICY_ACTIONS_PATTERN, assert);
  });

  test('IAM role trust policy contains the correct SSO principal', ({
    given,
    then,
    and,
  }) => {
    loadTemplate(given);
    assertSsoPrincipal(then, and);
  });
});
