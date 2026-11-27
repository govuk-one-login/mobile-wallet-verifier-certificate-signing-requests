# CA ITHC Runbook for Penetration Testers


## Contents
<!-- TOC -->
* [CA ITHC Runbook for Penetration Testers](#ca-ithc-runbook-for-penetration-testers)
  * [Contents](#contents)
  * [1. Overview](#1-overview)
    * [1.1 Objectives](#11-objectives)
    * [1.2 The programme of work](#12-the-programme-of-work)
    * [1.3 The nine areas of concern](#13-the-nine-areas-of-concern)
  * [2. The system](#2-the-system)
      * [Certificate lifecycle, in outline](#certificate-lifecycle-in-outline)
    * [2.1 Short-lived CA certificates](#21-short-lived-ca-certificates)
    * [2.2 How CA certificates reach relying parties](#22-how-ca-certificates-reach-relying-parties)
    * [2.3 What is deployed](#23-what-is-deployed)
  * [3. Your access](#3-your-access)
    * [3.1 What you will receive](#31-what-you-will-receive)
    * [3.2 Signing in and enrolling MFA](#32-signing-in-and-enrolling-mfa)
    * [3.5 Regions](#35-regions)
    * [3.6 Repository access and engagement materials](#36-repository-access-and-engagement-materials)
      * [GitHub access, cloning and tooling](#github-access-cloning-and-tooling)
      * [Engagement materials](#engagement-materials)
    * [3.7 Contacts and escalation](#37-contacts-and-escalation)
  * [4. Scope](#4-scope)
    * [4.1 Verifier account](#41-verifier-account)
    * [4.2 Root CA account](#42-root-ca-account)
    * [4.3 public CRL endpoints](#43-public-crl-endpoints)
    * [4.4 Out of scope](#44-out-of-scope)
      * [4.4.1 Organisation-owned infrastructure (both accounts)](#441-organisation-owned-infrastructure-both-accounts)
      * [4.4.2 Verifier account stacks](#442-verifier-account-stacks)
      * [4.4.3 Activities, in both accounts](#443-activities-in-both-accounts)
      * [4.4.4 Read-only inventory (both accounts)](#444-read-only-inventory-both-accounts)
    * [4.5 Repositories and code](#45-repositories-and-code)
  * [5. Rules of engagement](#5-rules-of-engagement)
  * [6. Scenarios, review guides and expected outcomes](#6-scenarios-review-guides-and-expected-outcomes)
    * [6.0 Coverage](#60-coverage)
    * [6.1 Issuance, activation and ceremony controls](#61-issuance-activation-and-ceremony-controls)
    * [6.2 Revocation and CA state changes](#62-revocation-and-ca-state-changes)
    * [6.3 Compromising the CAs](#63-compromising-the-cas)
    * [6.4 Malformed and malicious CSRs](#64-malformed-and-malicious-csrs)
    * [6.5 Detection and alerting (the one scenario expected to succeed)](#65-detection-and-alerting-the-one-scenario-expected-to-succeed)
    * [6.6 Lambda Code Review](#66-lambda-code-review)
    * [6.7 Infrastructure as Code Review](#67-infrastructure-as-code-review)
    * [6.8 GitHub Repository](#68-github-repository)
  * [7. Known and accepted positions](#7-known-and-accepted-positions)
    * [7.1 CRLs are served over plain HTTP](#71-crls-are-served-over-plain-http)
    * [7.2 ca-back is out of scope](#72-ca-back-is-out-of-scope)
    * [7.3 L3 issuance is single-operator](#73-l3-issuance-is-single-operator)
    * [7.4 Build is not production](#74-build-is-not-production)
    * [7.5 Slack notification](#75-slack-notification)
    * [7.6 A superseded copy of the validation rules exists](#76-a-superseded-copy-of-the-validation-rules-exists)
    * [7.7 Terraform is applied by operators, not by CI](#77-terraform-is-applied-by-operators-not-by-ci)
    * [7.8 How we manage vulnerabilities](#78-how-we-manage-vulnerabilities)
  * [8. Reporting](#8-reporting)
<!-- TOC -->

## 1. Overview

Our objective here is to give you, the NCC Group team, everything you need to deliver the Statement of Work efficiently: what the Mobile Wallet Verifier Certificate Authority is, which parts of it you are authorised to assess, where the evidence for each phase lives, and what we expect to happen when you test the controls we care most about. The runbook does not replace the Statement of Work; it sets out how to carry it out against the deployed system.

### 1.1 Objectives

The Statement of Work sets six objectives; the last two are combined here:

1. Confirm the effectiveness of GDS's vulnerability assessment and management processes for the service (section 7.8 describes them).
2. Identify vulnerabilities in the target systems that a malicious actor could exploit.
3. Check the areas of concern GDS has identified through its own risk assessments (section 1.3).
4. Validate the security controls in place, and their effectiveness.
5. Confirm that applicable technical standards for cyber security are being met, and provide actionable recommendations to mitigate risk.

### 1.2 The programme of work

The Statement of Work divides the engagement into five phases over nineteen days. The table shows where this runbook supports each one.

| Phase | Days | What it covers | Where to look in this runbook |
|---|---|---|---|
| **AWS Configuration Review** | 4 | The resources in the Root CA and Verifier ("Intermediate DVS CA") accounts that contribute to the issuance, management, revocation and auditing of certificates, and the access controls around them | Sections 2, 3 and 4; the configuration questions in 6.1 to 6.3 and 6.5; the commands in section 9 |
| **Lambda Code Review** | 4 | The three Lambda codebases: the CA expiry monitor, the CSR validator and the TxMA audit-event transformer | Section 6.6; the code-level questions in 6.4 |
| **Infrastructure as Code Review** | 3 | Terraform and CloudFormation in the three infrastructure repositories | Section 6.7 |
| **GitHub Repository and Actions Review** | 3 | Repository access controls and GitHub Actions workflows in five repositories | Section 6.8; the AWS side of the same pipeline path in 6.3, items 4 to 11 |
| **Scenario-Driven Assessment** | 5 | Active testing of the highest-risk areas of concern, building on the observations of the four review phases | Scenarios 6.1 to 6.5|

The phases build on one another by design. The scenario-driven assessment is the point at which observations from the configuration, code and repository reviews are combined into attack paths, so we recommend recording candidate paths against the scenarios in section 6 as you find them, rather than waiting for the final phase.

**What may run in which phase.**

- **The three code and repository review phases** can start with GitHub access alone. The items that compare source with what is deployed (6.6, 6.7 and 6.8) need AWS access and are carried to the first phase that has it.
- **The configuration review** needs AWS access but not GitHub.
- **Phase order** may be swapped by agreement with the engagement lead if one kind of access is ready before the other (section 3.1).
- **The harmless deny checks** in sections 9.7 and 9.8 may run from the configuration review onwards.
- **CSR submission on your behalf** (scenario 6.4) is available from the Lambda Code Review.
- **The real-ARN calls** in section 9.5 and **every supported active test** under section 5.3 run only in the scenario-driven assessment, unless we agree otherwise in writing.

### 1.3 The nine areas of concern

The Statement of Work names nine areas of concern. They cut across the five phases, and the coverage table in section 6.0 shows where each is addressed:

1. Root CA isolation, state changes and ceremony mechanics.
2. IAM permission boundaries and privilege escalation.
3. Certificate issuance and authorisation controls.
4. CSR validation and processing security.
5. Trust artefact publication, integrity and security.
6. Trust artefact availability and distribution resilience.
7. API security and information disclosure.
8. CI/CD and Infrastructure-as-Code security.
9. Audit logging and monitoring integrity.

---

## 2. The system

The Verifier CA is a four-level X.509 PKI built on AWS Private CA (ACM PCA). It establishes the digital root of trust for ISO/IEC 18013-5 mobile driving licences (mDLs) in the GOV.UK Wallet ecosystem: relying-party organisations and verifier applications must prove their authenticity and authorisation before an mDL holder's device discloses identity information, and the certificates this PKI issues are how they do so. The estate is serverless and spans two AWS accounts: an isolated **Root CA account**, and the **Verifier account**, which the Statement of Work calls "Intermediate DVS CA".

| Level | What it is | Key and algorithm | Path length | Where the key lives |
|---|---|---|---|---|
| **L1** | Root CA — the trust anchor | EC P-384, `SHA384WITHECDSA` | Root (unconstrained) | AWS Private CA, FIPS 140-2 Level 3. Isolated Root CA account, stack `root-ca` |
| **L2** | DVS Intermediate CA — the Root's only long-lived direct subordinate | EC P-384, `SHA384WITHECDSA` | `pathLen 1` | AWS Private CA, FIPS 140-2 Level 3. Verifier account, stack `dvs-ca` |
| **L3** | Test DVS Verifier CA | EC P-256, CRL disabled | `pathLen 0` | AWS Private CA. Verifier account, stack `govchk-ca` (out of scope) |
| **L3** | Organisation CAs | EC P-256 | `pathLen 0` | **Held by the partner organisation**, not by us. Only the CSR and the signed certificate pass through the `verifier-csr` stack |
| **L4** | Reader certificates, 90-day validity | EC P-256 or P-384 | End entity | Issued on demand, not a stack |

Because the Root's only long-lived direct subordinate is the DVS Intermediate CA, a reader certificate chain is four certificates deep. Path length is set by the issuer at signing time, not requested by the subordinate: `pathLen 1` at L2 permits exactly one further CA level below it, and `pathLen 0` at L3 permits none. If you can obtain a certificate whose path length exceeds what its issuer should allow, that is a finding.

**Private keys of the CAs we operate never leave AWS Private CA.** That covers L1, L2 and the Test DVS Verifier CA, all created with `KeyStorageSecurityStandard: FIPS_140_2_LEVEL_3_OR_HIGHER`. AWS Private CA exposes no key-export API, and no code in any of our repositories imports or exports CA key material. The defensible claim is "no key-export path exists in the service API or in our code", not "extraction is impossible" — if you can demonstrate otherwise, that is the single highest-value finding available in this engagement. Organisation CA keys are generated and held by the partners and are outside this engagement.

#### Certificate lifecycle

- **Organisation CA (L3) issuance** is a human ceremony. A CSR is uploaded to an intake S3 bucket, a Lambda (`csr-validator`) validates it against eleven rules, and an operator signed in through a specific IAM Identity Center (SSO) permission set runs a CLI (`npm run issue-revoke-ca`) that signs it through ACM PCA. Organisation CA issuance is never automatic; the pipelines do issue short-lived test CA certificates automatically (section 2.1).
- **Issuance at L1 and at L2** is a two-operator ceremony, each run with its own CLI. At L1 the two-operator split is enforced technically for **activation**; after activation, one operator can issue from the Root alone. At L2 the pipeline principals in the Verifier account cannot sign the DVS certificate, which is signed by the Root, but we believe they can issue from, replace, disable or delete the DVS CA without an operator. Scenario 6.1 sets out both limits and asks you to confirm them.
- **Revocation** publishes a CRL at **L1 and L2 only**. Those two CAs are the issuers with `CrlConfiguration` enabled, each writing to its own S3 bucket served through CloudFront: a certificate the Root revokes (an L2) appears on the Root's CRL, and a certificate the DVS Intermediate CA revokes (an L3) appears on the L2's CRL. **The Test DVS Verifier CA has its CRL disabled**, so revoking an individual L4 reader certificate publishes nothing anywhere; the 90-day leaf lifetime is the revocation strategy at that level. How partner Organisation CAs publish revocation is outside this engagement.

### 2.1 Short-lived CA certificates

Three routine activities issue short-lived (1-day) `PathLen0` subordinate CA certificates under the standard `SubordinateCACertificate_PathLen0/V1` template. That template adds **no NameConstraints**, and the keys are generated **outside** AWS Private CA. Expect to find them in audit reports and CloudTrail; they are not evidence of compromise, but how they are handled is in scope (scenario 6.3, items 9 and 10).

| Activity | Issued by | Key generated | Revoked? |
|---|---|---|---|
| `dvs-ca` pipeline integration tests, every run | The DVS CA, by the pipeline's test role | In the CodeBuild container, as an **extractable** P-384 key | The `issue-subordinate` test does **not** revoke its certificate; the TxMA tests do |
| `root-ca` pipeline TxMA integration tests, every run | The **Root CA**, by the pipeline's test role, which the SCP's issuance exemption does not name (see 6.1) | In the CodeBuild container | Yes, by the same tests |
| CRL distribution-point probes by Wallet Backend team operators | The Root CA | With `openssl` on the operator's workstation | Yes, immediately |

Section 3.6 tells you how to recognise each of them.

### 2.2 How CA certificates reach relying parties

The Statement of Work's trust-artefact areas of concern cover CA certificates as well as CRLs, so it is worth stating what we know about how the certificates are published. The Root CA certificate is pinned in the Wallet app. Each CA stack writes issued certificates to an issued-certificates bucket; The `mobile-wallet-verifier-csr` repository stores Root CA certificate PEM files (section 6.8).

### 2.3 What is deployed

The Statement of Work's resource inventory was drawn up from scoping conversations and is, in places, an estimate. The table reconciles it with what is deployed in Build, so that a difference is not mistaken for a finding or for an undisclosed resource. Sections 4.1 and 4.2 give the full stack lists. The left-hand column keeps the Statement of Work's wording: its "DVS account", "DVS Intermediate account" and "Intermediate DVS CA" account are all our Verifier account, and its "Test Verifier CA" is our Test DVS Verifier CA.

If what you find differs from the right-hand column — an extra function, CA, IAM user, trail or bucket — report it in the engagement channel, and treat it as unverified, not as in scope, until we answer.

| Statement of Work | What you will find in Build |
|---|---|
| AWS Private CA (2): Root CA and DVS Intermediate CA | Both, as described above. The Verifier account also holds a third CA, the Test DVS Verifier CA (`govchk-ca`), which the Statement of Work excludes |
| "Ceremony Windows", Just-in-Time elevation and M-of-N quorum at the Root CA | AWS Private CA enforces none of these, as the Statement of Work notes. What exists is a two-operator split built from IAM Identity Center permission sets, a just-in-time approval workflow for those sets, the organisation SCP, and two ceremony CLIs. There is no technical M-of-N quorum. Section 6.1 sets out how the ceremonies run and where the split holds |
| S3 buckets (2), one per CA | More than two. Each CA stack has four buckets: CRL, issued-certificates, audit-report and logs. `crl-health` adds a canary artefact bucket; `verifier-csr` adds the two CSR buckets; each pipeline adds artefact buckets |
| Route 53 zones (1) | Two, one per account: `verifier-root-ca.build.account.gov.uk` (Root CA account) and `verifier-ca.build.account.gov.uk` (Verifier account) |
| CloudFront distributions (2), one per CRL | Two CRL distributions, as stated. The Verifier account has a further distribution in front of the out-of-scope API Gateway |
| AWS Lambda (4), DVS Intermediate account only | Three in scope, not four. All three are in the Verifier account, and they are the three named for the Lambda Code Review: `ca-expiry-monitoring-ca-expiry-monitor`, `verifier-csr-csr-validator` and `dvs-ca-txma-audit-events-transformer`. `lambda list-functions` will show more: the out-of-scope `ca-back` functions (4.4.2), the functions that back the two `crl-health` Synthetics canaries, and organisation-owned functions (4.4.1). No function of ours processes CloudTrail logs directly: CloudTrail events reach the transformer through EventBridge and SQS |
| No Lambda functions in the Root CA account | True of the Wallet Backend team's own templates. Several of the DevPlatform-template stacks the Wallet Backend team deploys in that account do carry functions, and those are in scope (section 4.2) |
| IAM: no per-account users; approximately five roles and five policies | No standing IAM users other than the ones created for you (section 3). Human access is through IAM Identity Center. There are considerably more than five roles once pipeline and platform roles are counted; `iam:GetAccountAuthorizationDetails` gives the full picture (6.3) |
| Administrative access governed by "phishing-resistant MFA, role separation and approval processes" | Set in IAM Identity Center, which you cannot read from a member account. The entitlement map states the MFA types enforced for the elevated permission sets, and the walkthrough covers the approval process (section 3.6). Your own IAM users use virtual MFA devices, which is not the operators' arrangement |
| Security groups (fewer than ten); VPC in the DVS account only | Partly. Only `verifier-csr-csr-validator` runs in the VPC's private subnets. The audit-event transformer and the expiry monitor are not VPC-attached: they call only AWS service APIs. The Root CA account has no VPC |
| SQS: audit delivery to TxMA, DVS account only | The TxMA transformer and producer queues, with their dead-letter queues, in the `dvs-ca` stack; the `ca-expiry-monitoring` stack has a dead-letter queue of its own |
| CloudTrail "enabled to support auditing and monitoring" | Neither CA stack deploys a trail. Detection relies on an organisation trail we do not own and whose delivery we have not confirmed (scenario 6.5) |
| EventBridge: Root CA sends event details to the DVS account's SQS queue | As stated: the `root-ca` stack's TxMA rule routes cross-account into the Verifier account's transformer queue (6.3, items 15, 16 and 18) |

---

## 3. Your access

This section covers the prerequisites the Statement of Work asks of us: AWS console and API access with `ReadOnlyAccess` and `SecurityAudit`, copies of the code and Terraform, GitHub access, and a technical point of contact who can resolve or escalate access problems (section 3.7).

### 3.1 What you will receive

In the **Build** environment each named consultant will receive:

- An IAM user in **both** the Root CA account and the Verifier account. Both accounts are in scope (section 4).
- A sign-in URL per account, of the form `https://<account-id>.signin.aws.amazon.com/console`, and a username.
- An initial password per account, which you must change at first sign-in. It is delivered to you **out of band by the engagement lead.
- Read access to the five GitHub repositories named in the Statement of Work, and the supporting engagement materials (section 3.6).

You authenticate as an IAM user and work with MFA-backed session tokens (section 3.4) rather than switching roles. This is the arrangement the Statement of Work prefers.

GitHub access is confirmed in the same way as AWS access: the Wallet Backend team confirms it for each consultant in the engagement channel. If either has not been confirmed one working day before the first phase that needs it, contact the engagement lead; section 1.2 says which phases need which kind of access.

### 3.2 Signing in and enrolling MFA

1. Sign in with the URL, username and initial password, and set a new password when prompted. **If the password change is refused, stop** and post in the engagement channel, naming the account: you are blocked, and the Wallet Backend team will fix it.
2. Register a virtual MFA device for your user.
3. **Sign out and sign back in using MFA.** A console session that began before you registered the device carries no MFA context, so it will still hit the deny described in section 3.3.
4. Once your MFA device is registered, post in the engagement channel, naming the account. The Wallet Backend team will add you to the IAM group **`pen-tester-access-PenPerfTester`** in that account within one working day and confirm in the channel. If that has not happened within one working day, contact the engagement lead.

Until you are in the group, you hold no permissions beyond self-management, and that is expected rather than a misconfiguration.

### 3.5 Regions

Work in `eu-west-2` unless a scenario says otherwise. Two in-scope stacks are in `us-east-1` (section 4.2); working in that region is also permitted. For your IAM users the organisation's region SCP effectively allows `eu-west-2`, `eu-west-1`, `us-east-1` and `us-west-2`. `us-west-1` and `eu-central-1` are open only to SSO and automation roles, so a deny there is expected, as is a deny in any other region. We took this region list from the organisation's SCP *rollout* configuration; we have not confirmed that the SCP is attached to these accounts. Global services (IAM, STS, CloudFront, Route 53) sit outside any single region.

### 3.6 Repository access and engagement materials

#### GitHub access, cloning and tooling

**GitHub access.** Each named consultant is given read access to the five repositories in the `govuk-one-login` organisation that the Statement of Work names (section 4.5), for the Lambda Code Review, the Infrastructure as Code Review and the GitHub Repository and Actions Review. Dependencies are declared in each package's `package.json` and lock file; nothing in scope is a compiled application.

#### Engagement materials

Some of what the scenarios ask about cannot be read from inside the accounts or the repositories, so we supply it. The repositories themselves are not redacted.

| What | Why | Used in |
|---|---|--|
| The organisation SCP `DenyAcmPcaActionsExceptApprovedRoles` (file `level_3/deny_acm_pca_actions_except_approved_roles_v1.yaml`) and evidence of its attachment to both Build accounts | `organizations:Describe*` fails outside the management account, and neither `ReadOnlyAccess` nor `SecurityAudit` helps |  |
| **Entitlement map** for the two Build accounts only: each IAM Identity Center permission set that can reach them (including `ApprovedAdmin`, `ApprovedPowerUser`, `ApprovedMobWalletCAIssueRevoke`, `ApprovedMobWalletCAEnableDisable` and the standing read-only sets) and its policies; the groups eligible for each, shown by role or pseudonym with member counts, not names; any pseudonymous person eligible for more than one elevated set; the MFA types enforced for the elevated sets; and the just-in-time approval workflow, without approver identities | Identity Center cannot be read from a member account, and separation of duties depends on *who* is entitled, not only on role names |  |
| The inline policies `AllowMobileWalletRootCAIssueRevoke` and `AllowMobileWalletRootCAEnableDisable` | They define what the ceremony operators can do |  |
| **Pointers to the L1 and L2 ceremony code** in the repositories: the Root CA CLI (`scripts/issue-activate-revoke-root-ca.ts` and `scripts/lib/ca-ceremony/` in `mobile-wallet-verifier-root-ca`) and the DVS CA CLI (`dvs/scripts/lib/ca-ceremony/` in `mobile-wallet-dvs-intermediate-ca`), including their operator confirmation steps | The ceremony CLIs are the "local CLI scripts" the Statement of Work asks you to assess; you read them directly in GitHub |  |
| The **record of the most recent Build L1 and L2 ceremonies**, including the principal that wrote each object to the handover bucket, and which artefact version is current | So that you can check ceremony output against what happened |  |
| **Known issuances**: the list of Build issuances from the Root, and how to recognise the routine certificates in section 2.1 (template `SubordinateCACertificate_PathLen0/V1`, 1-day validity, the pipeline test-role principal or the operator, the test subject naming) | Without it, routine issuances could be reported as compromise |  |
| **DevPlatform pipeline role extracts** at the deployed version (`sam-deploy-pipeline`, v0.16.0): the `TestPolicy`, `DeployPolicy` and permissions-boundary statements that concern ACM PCA, CloudTrail, CodeBuild and promotion, with their conditions | Conditions such as "not production" and the promotion logic cannot be read from the deployed roles |  |
| **Pointers to the L3 code** in `mobile-wallet-verifier-certificate-signing-requests`: the eleven validator rules (`src/utils/csr-validation/`), the signing path's subject extraction and NameConstraints construction (`scripts/lib/issue-revoke/issue.ts`), and the operator CLI's approval prompt and re-validation step (`scripts/issue-revoke-ca.ts`) | The signing path is operator CLI code, not Lambda code, but it is where a validated CSR becomes a certificate |  |
| **A ceremony and elevation walkthrough** (60 to 90 minutes, on a call) with a ceremony operator and an Identity Center approver: how a just-in-time request is raised, approved and expires, and how an L1 or L2 ceremony is scheduled, run and recorded | The Statement of Work asks for active discussion of the procedural controls that stand in for M-of-N quorum |  |
| **The deployed commit** of each in-scope application stack in Build, and notice in the engagement channel of every Build deployment to an in-scope stack during the engagement | `main` can move ahead of what is deployed, and a routine merge deploys Build |  |
| **Repository settings export** for the five repositories: branch protection and rulesets, required reviews and status checks, environments and their protection rules, the names (not values) of Actions secrets and variables, collaborators and teams by role, Actions permissions, and the current open-alert counts (Dependabot, code scanning, secret scanning) | Read access to a repository does not show them |  |
| CSR submission on your behalf, with the full validation report returned | You cannot write to the intake bucket |  |
| One operator-performed L3 issuance, to test extension handling | It requires a real issuance |  |

### 3.7 Contacts and escalation

If you suspect a live incident rather than a test finding, follow the [GOV.UK One Login incident management process](https://team-manual.account.gov.uk/supporting-govuk-one-login/managing-incidents/#managing-incidents-for-gov-uk-one-login) and tell the engagement lead at once.

---

## 4. Scope

The Statement of Work brings into scope the resources in the two AWS accounts that are owned, managed and configured by the Wallet Backend team and that directly contribute to the issuance, management, revocation and auditing of certificates used for mDLs, together with the code, infrastructure definitions and GitHub workflows that build and deploy them. This section sets out, as named stacks, endpoints and repositories, what you are authorised to touch. For the Root CA account it follows the Statement of Work for everything the Wallet Backend team owns; organisation-owned components are excluded in both accounts (4.4.1). For the Verifier account it is a narrowing. Both are among the variations we are proposing (section 1).

**Environment.** Testing covers **Build only**. The Statement of Work describes the target as the "staging/preproduction" environment; in this estate that is Build. The Root CA has no staging environment, the DVS Intermediate CA is not deployed to staging, and Build is the first environment in which both CAs and all of their pipelines exist. The Statement of Work's overview also describes an "AWS Integration environment". The estate does have environments named `staging` (Verifier account set only) and `integration`, and you will see both in the repositories; neither is the target. If NCC Group scoped or priced the work against either, tell the engagement lead before starting.

Names below are CloudFormation stack names as deployed in Build. The two accounts are scoped differently, as summarised below; section 4.4 gathers everything that is out of scope, and section 4.5 lists the repositories.

| Where | In scope | Out of scope |
|---|---|---|
| Verifier account | The twelve stacks in 4.1, which are the resources that contribute to the PKI, and the CRL endpoint in 4.3 | Everything else in the account, including the stacks in 4.4.2 (with the read-only exceptions in 4.4.2 and 4.4.4) |
| Root CA account | **Every** stack the Wallet Backend team owns (4.2), and the CRL endpoint in 4.3 | Organisation-owned infrastructure (4.4.1) |
| GitHub | The five repositories in 4.5, for code, Infrastructure as Code and workflow review | Every other repository, including the `ca-back` "backend" repository; any change to a repository (4.4.3) |

The Statement of Work describes the configuration review as exhaustive across both accounts. For the Root CA account that is literally the case. The Verifier account also hosts the out-of-scope reader-certificate backend and Test DVS Verifier CA, so there we have drawn the "directly contribute" line at the twelve stacks in 4.1. If you believe a resource outside them belongs in scope, raise it with the engagement lead and we will decide quickly. The engagement lead may clarify scope in the engagement channel. A scope addition is valid only as a written message from the engagement lead there, naming the resource and what may be done to it; an addition that goes beyond the Statement of Work also needs NCC Group's change control.

### 4.1 Verifier account

> **Caveat.** Unlike the Root CA list in section 4.2, this list has **not** yet been verified against the deployed Build account; it is taken from the engagement scope definition. The account contains a number of further stacks the Wallet Backend team owns which are deliberately **not** in scope (section 4.4.2). If you find something that looks in scope but is not listed, ask before testing it.

| Stack | What it is |
|---|---|
| `dvs-ca` | The DVS Intermediate CA (L2): the ACM PCA, its CRL bucket and CloudFront distribution, logs, issued-certificate and audit-report buckets, IAM roles (including `dvs-ca-TxmaE2ETestCrossAccountRole`, see 6.3), EventBridge detection rules, and the TxMA audit routing — the transformer and producer queues, their KMS key and the audit-event transformer Lambda |
| `verifier-csr` | CSR intake and validation: the `csr-received` and `csr-validated` buckets with their own KMS keys, the `verifier-csr-csr-validator` Lambda, and the two L3 operator IAM roles |
| `ca-expiry-monitoring` | Daily CA expiry monitor: a scheduled Lambda, its KMS key, DLQ, and warning and critical alarms for both the DVS and Root CAs |
| `crl-health` | Two CloudWatch Synthetics canaries that poll the DVS and Root CA CRL endpoints, plus their alarms |
| `alerting` | Shared SNS critical and warning topics, the SSM parameters that publish their ARNs, and the AWS Chatbot Slack integration |
| `vpc` | The VPC whose private subnets host the `csr-validator` Lambda. In scope because scenario 6.4 depends on its isolation properties |
| `dvs-ca-pipeline-build` | Deployment pipeline for `dvs-ca`. High-value target; see scenarios 6.1 and 6.3 |
| `verifier-csr-pipeline-build` | Deployment pipeline for `verifier-csr` |
| `ca-expiry-pipeline-build` | Deployment pipeline for `ca-expiry-monitoring` |
| `crl-health-pipeline-build` | Deployment pipeline for `crl-health` |
| `dvs-ca-image-repo-build` | ECR repository holding the test container image used by the `dvs-ca` pipeline |
| `pen-tester-access` | The stack that provisions your own access (once deployed, section 3) |

### 4.2 Root CA account

**Every stack the Wallet Backend team owns in the Root CA account is in scope, including all of its pipelines.** This account is the isolated home of the Root CA (L1), the trust anchor for the whole hierarchy, so there is nothing of ours in it that we want excluded.

The list below was verified against the deployed Build account on 2026-11-24 with `describe-stacks` in both regions, so at that date it was exhaustive for team-owned stacks. The only expected addition is `pen-tester-access`, once it is deployed.

**`eu-west-2`:**

| Stack | What it is |
|---|---|
| `root-ca` | The Root CA (L1): the ACM PCA, its CRL bucket and CloudFront distribution, logs, issued-certificate and audit-report buckets, four IAM roles (below), the daily audit-report scheduler, four EventBridge detection rules plus the cross-account TxMA routing rule |
| `rootca-pipeline-build` | Deployment pipeline for `root-ca` |
| `rootca-image-repo-build` | ECR repository holding the test container image used by the `root-ca` pipeline |
| `alerting` | This account's own SNS critical and warning topics and Chatbot Slack integration |
| `cloudwatch-alarm-stack` | Shared alarm infrastructure |
| `dns` | The `verifier-root-ca.build.account.gov.uk` hosted zone |
| `github-identity` | The GitHub OIDC identity provider, and the roles it lets GitHub Actions assume to upload artefacts into the pipeline |
| `signer`, `container-signer` | Code and container signing profiles and keys for the pipeline |
| `build-notifications` | Pipeline build notifications to Slack |
| `ecr-image-scan-findings-logger` | Logs ECR image scan findings |
| `s3-access-logs-bucket` | Destination bucket for S3 access logs |
| `pen-tester-access` | The stack that provisions your own access (once deployed, section 3) |

**`us-east-1`:**

| Stack | What it is |
|---|---|
| `root-ca-cloudfront-alarms` | CloudFront alarms for the CRL distribution |
| `dns-records` | The `root.` CRL DNS record and its associated certificates |

**The four IAM roles in the `root-ca` stack**, listed here because you will reconcile your findings against them: `AuditReportSchedulerRole`, `CAMonitoringCrossAccountRole`, `TxMAEventBridgeRole`, and `TxmaE2ETestProxyRole`. The last of those exists in Build because the pipeline supplies a `TestRoleArn`; it trusts the pipeline's test role directly and grants permission to assume a role in the Verifier account. It is the most interesting role in this account, and we would like your view on it (see 6.3).

**There is no VPC in this account** (`vpc_enabled = false`), and the Wallet Backend team's own templates deploy no Lambda-backed CloudFormation custom resources here — deliberately, to minimise compute next to the trust anchor. That is a statement about *our* templates only: several of the supporting DevPlatform-template stacks listed above, which the Wallet Backend team deploys, do carry Lambda functions, and those are in scope. They are distinct from the organisation-owned stacks in 4.4.1, which are not.

### 4.3 public CRL endpoints

The **publicly reachable CRL endpoints** for Build need no credentials and are in scope:

```
http://dvs.verifier-ca.build.account.gov.uk/crl/f7dca026-dbf9-402a-afd0-5f924811d521.crl
http://root.verifier-root-ca.build.account.gov.uk/crl/4d5f9e5f-a762-4423-a87e-d044725a64df.crl
```

Both are also served over HTTPS (see 7.1).

> **Two practical notes.**
> Any HTTP client you point at these endpoints must send an explicit `User-Agent` header. AWS Firewall Manager applies a managed `NoUserAgent_HEADER` rule centrally and returns **403** to requests without one. Node's `http` module sends no `User-Agent` by default, so a bare script will look like a blocked endpoint when it is not. This has caught us out more than once.
> The CRL object is named `crl/<CA id>.crl`, where `<CA id>` is the final segment of the CA's ARN, so it changes if a CA is rotated or recreated. Before concluding an endpoint is down, derive the current path from the CA ARN as shown in section 9.6 rather than trusting the URLs above.

### 4.4 Out of scope

The Statement of Work excludes the following, and the sub-sections below show how each exclusion appears in the two accounts. The in-scope repositories follow in section 4.5.

**What "out of scope" means in practice.** Your AWS access is read-only everywhere, so the credentials do not mark the line between in scope and out of scope. For an out-of-scope resource: do not read it beyond what a read-only exception allows, do not make deny-confirmation calls against it, and do not report on it except as a route into an in-scope resource.

**The read-only exceptions**, all of which permit reading and nothing else:

- CloudTrail trail configuration, in both accounts, for scenario 6.5 (4.4.1).
- The `ca-back` issuance role; `github-identity` and `signer`; and `dns`, `dns-records` and `dvs-ca-cloudfront-alarms`, in the Verifier account (4.4.2).
- Account-wide inventory, in both accounts (4.4.4).

| Statement of Work exclusion | What that means here |
|---|---|
| DVS-operated subordinate CA infrastructure; DVS environments and systems | Organisation (L3) CAs and their keys are held by the partner organisations. Only the CSR and the signed certificate pass through our `verifier-csr` stack, which **is** in scope |
| DVS-issued Reader Authentication certificates; the GOV.UK Wallet application; GOV.UK verifier applications and services | The L4 reader-certificate issuance path and its consumers (4.4.2) |
| The Test Verifier CA, which "lives in the DVS account, but is not in scope" | Our Test DVS Verifier CA: `govchk-ca` and its pipeline (4.4.2) |
| AWS API Gateway in the Verifier account — test infrastructure; the "backend" repository | `ca-back`, `ca-base` and their pipelines, and the `mobile-wallet-verifier-ca-back` repository (4.4.2) |
| Intermediate CA – Public Sector; Backup Root CA | Not deployed in Build. You should find neither CA in either account, and no buckets or distributions for them; a CA you cannot account for is therefore worth reporting (scenario 6.2) |
| AWS-managed HSM infrastructure; AWS Private CA service internals | The service itself. Our *configuration and use* of AWS Private CA is in scope |
| EC2 or other compute | None is expected: the solution is serverless. Report any you find in a team-owned stack |

#### 4.4.1 Organisation-owned infrastructure (both accounts)

Both accounts contain infrastructure owned by other GDS teams and deployed by the organisation rather than by us: landing-zone stacks (`AWSAccelerator-*`), Control Tower baselines and other `StackSet-*` stacks, AWS Config conformance packs (`awsconfigconforms-*`), third-party security and observability connectors deployed organisation-wide, the DevPlatform template conformance stack, the cross-account observability links, and `Root-Console-Sign-In-CloudTrail`.

**These are out of scope in both accounts.** We cannot authorise testing of infrastructure we do not own. If you believe one of these platform components creates a route into the CA — a legitimate and interesting question — **report the route to us rather than testing the component.** We will take it to the owning team, and if they authorise a follow-up we will reissue this runbook.

The same applies to the centrally managed WAF and Firewall Manager rules in front of the CRL endpoints (section 4.3). Sending requests that comply with them in order to reach an in-scope endpoint is fine; probing or attempting to bypass them is not ours to authorise — report any concern instead.

**One exception, for scenario 6.5:** read-only inspection of trail configuration — `cloudtrail:DescribeTrails`, `GetTrail`, `GetTrailStatus`, `GetEventSelectors` and `LookupEvents` — is permitted against any trail visible in either account, including organisation-owned ones. Apart from this and the account-wide inventory in 4.4.4, nothing else on those components is.

#### 4.4.2 Verifier account stacks

Everything in the Verifier account that is not listed in section 4.1 is out of scope. That includes the Wallet Backend team's own base stacks there — for example `dns`, `dns-records`, `cloudfront-distribution`, `github-identity` and `signer` — and, by name:

| Stack | |
|---|---|
| `govchk-ca` | The Test DVS Verifier CA (an L3). Its CA appears in `list-certificate-authorities`; do not target it |
| `govchk-ca-pipeline-build` | Its pipeline |
| `ca-back` | The Verifier CA backend, including the `POST /issue-reader-cert` API and the L4 reader-certificate issuance path |
| `ca-back-pipeline-build` | Its pipeline |
| `ca-base` | Shared API Gateway custom domains |
| `ca-base-pipeline-build` | Its pipeline |
| `ca-back-image-repo-build` | ECR repository for the `ca-back` pipeline |

Do not test these stacks, their endpoints, or the L4 reader-certificate issuance path, unless a change to the Statement of Work brings them into scope and you receive an updated runbook.

**Three read-only exceptions in this account.** In each, you may read configuration and policies; you may not invoke, assume, write or change anything.

- **The `ca-back` issuance role (scenario 6.3).** The `ca-back` Lambda's issuance role matches the SCP exemption `*-issue-reader-cert-service-role*`, so it is one of the few principals able to reach `IssueCertificate`. That exemption applies to every resource, so the role's own IAM policy is the only limit on which CA it can issue from. You may read that role's identity and trust policies. Invoking the function, calling its API, or assuming the role is not permitted.
- **`github-identity` and `signer` (scenario 6.3, CI/CD).** The in-scope Verifier pipelines rely on these for identity and code signing. You may read the roles the GitHub OIDC provider trusts (their trust conditions and permissions), the artefact source bucket policies, and the signing profiles and keys.
- **`dns`, `dns-records` and `dvs-ca-cloudfront-alarms` (scenario 6.2).** The DVS CA's CRL domain is built from the `dns` stack's export, and `dvs-ca-cloudfront-alarms` (in `us-east-1`) is the DVS counterpart of the in-scope `root-ca-cloudfront-alarms` stack. You may read these stacks' settings, exports, record sets, alarms, termination protection and stack policies, and who can update them.

#### 4.4.3 Activities, in both accounts

- **Creating IAM users or roles, or granting any principal additional permissions.** Enumerating and reasoning about IAM is in scope; *using* a path to grant yourself privilege is not — see section 5.
- **Changing anything in GitHub.** The five repositories in section 4.5 are in scope for review: code, Infrastructure as Code, workflows and access controls. Review is read-only. Do not push branches, fork, open pull requests, trigger or re-run workflows, or create issues, releases, deploy keys or secrets; a workflow run in these repositories can upload an artefact that a Build pipeline deploys and promotes onward. The one credential you may create is the read-only clone credential described in section 3.6. You may read workflow run logs and download run artefacts; Where the Statement of Work asks you to evidence how unauthorised code could be introduced, establish the path by review and stop at the point of proof; if a demonstration would add real value, propose it under section 5.3. Every other repository in the organisation is out of scope.
- **Active DNS or subdomain enumeration** against `*.build.account.gov.uk` from outside the accounts. That zone is shared with other services. Passive inspection of the in-scope DNS stacks' records through the AWS API is in scope. Ask the engagement lead if you want an exception.
- **Denial of service.** See section 5.2.
- **Any environment other than Build.** Do not touch dev, staging, integration or production. Build pipelines promote their artefacts onward, though, so when you rate a Build pipeline finding, reason about its downstream impact (scenario 6.3) without testing it.

#### 4.4.4 Read-only inventory (both accounts)

Several items in scenario 6.3, the reconciliation in section 2.3 and the commands in section 9 ask for an inventory across a whole account. That inventory is permitted in both accounts, including where it returns out-of-scope or organisation-owned resources:

- **List- and describe-level calls** that return names and metadata: IAM, CloudFormation, Lambda, ACM PCA, S3, KMS, SQS, ECR, CodeBuild, CodePipeline, EventBridge and SSM parameter names.
- **IAM roles, policies and trusts, resource policies and key policies**, where a 6.3 item asks for them.

For an out-of-scope resource, do not open contents, values or code, and record only what bears on a route into an in-scope stack. This permission does not extend to Terraform state: establish who can read or write the state buckets from their policies, but do not open the state objects, which describe more than the in-scope stacks.

### 4.5 Repositories and code

All five repositories are private and sit in the `govuk-one-login` GitHub organisation. The table shows which review phase each one belongs to under the Statement of Work.

| Repository | Lambda Code Review | IaC Review | GitHub and Actions Review | What it holds |
|---|--|--|---|---|
| `mobile-wallet-verifier-root-ca` |  | Yes | Yes | The `root-ca` template (`root-ca.yaml`), the Terraform that orchestrates the Root CA account's base stacks and pipeline, and the L1 ceremony CLI |
| `mobile-wallet-dvs-intermediate-ca` | Yes: `ca-expiry-monitoring/` and `dvs/src/functions/txma-audit-events-transformer/` | Yes | Yes | The `dvs-ca` template (`dvs/dvs-intermediate-ca.yaml`), the `ca-expiry-monitoring` and `crl-health` stacks, their pipelines, and the L2 ceremony CLI |
| `mobile-wallet-verifier-ca-infra` |  | Yes | Yes | The Terraform and templates for the Verifier account's base stacks (VPC, DNS, certificates, GitHub OIDC, signing, alerting) and pipelines. Its `gov-checker/` directory and `gov-checker-ci-cd.yml` workflow belong to the out-of-scope Test DVS Verifier CA |
| `mobile-wallet-verifier-certificate-signing-requests` | Yes: `src/csr-validator/` and `src/utils/csr-validation/` | Not listed | Yes | The `verifier-csr` stack (`template.yaml`), the `csr-validator` Lambda, the L3 operator roles and the `issue-revoke-ca` CLI |
| `mobile-wallet-verifier-csr` |  |  | Yes | An older, pull-request-based CSR checker (`csr-checks.yml`) and a store of Root CA certificate PEM files. It is not on the live issuance path (section 7.6) |

Two observations will help you plan. First, the Statement of Work's IaC Review lists three repositories and so omits `template.yaml` in `mobile-wallet-verifier-certificate-signing-requests`, which defines the CSR intake buckets, the validator's execution role and the two L3 operator roles. We would value your reading it alongside the validator code, if time allows. Second, the Statement of Work associates CSR validation with `mobile-wallet-verifier-csr`. We are correcting the Statement of Work on that point, and propose the correction as a variation (section 1): the validation that gates issuance is in `mobile-wallet-verifier-certificate-signing-requests`, and that is where the CSR effort belongs.

Sections 6.6 to 6.8 guide the review phases.

---

## 5. Rules of engagement
(? Do we have rules of engagement that we want to highlight)

---

## 6. Scenarios and expected outcomes

This table shows where each of the Statement of Work's nine areas of concern (section 1.3) is addressed, the phases in which we expect the work to fall, what we supply for it, and its limits. The Phases column is our expectation, not a restatement of the Statement of Work's own assignment. Scenarios 6.2 and 6.5 serve areas that the Statement of Work places in the configuration review. The section 9.7 and 9.8 deny checks (scenarios 6.1 and 6.2) may run from that phase onwards. The real-ARN calls of 6.5 need both pipelines paused, so their window is booked for the scenario-driven assessment (section 1.2).

| Area of concern | Phases | Where it is addressed | Supplied for it (section 3.6) | Limits |
|---|---|---|---|---|
| **1. Root CA isolation, state changes and ceremony mechanics** | Configuration; Scenario | 6.1 *How the L1 and L2 ceremonies run* and items 1–7; 6.2 (whole scenario); 6.3 items 2 and 12–19; section 4.2 (`TxmaE2ETestProxyRole`); sections 9.3, 9.4 and 9.7 | Entitlement map; both inline operator policies; pointers to the ceremony code; ceremony record; known issuances; the ceremony and elevation walkthrough | You cannot run a ceremony; you assess its code, its controls and its output. You confirm state changes only as *denied*, using the harmless forms. Human access paths come from the entitlement map |
| **2. IAM permission boundaries and privilege escalation** | Configuration; Scenario | 6.0 *The SCP and its exemption patterns*; 6.3 items 1–3 and 20–24; 6.1 items 1, 6 and 8; section 3.4 | Entitlement map; the SCP; DevPlatform role extracts | You find and report escalation routes; you do not use them. Permission-set assignment data comes from the entitlement map |
| **3. Certificate issuance and authorisation controls** | Configuration; Lambda code; Scenario | 6.1 (whole scenario); 6.3; 6.4 *Controls* and items 1, 3 and 6; 6.6; section 7.3 | Both inline operator policies; the SCP; pointers to the L3 code; one operator-performed issuance | Issuance is confirmed as *denied*, or performed by an operator under section 5.3 |
| **4. CSR validation and processing security** | Lambda code; Scenario | 6.4 (whole scenario); 6.6; 7.6 | Pointers to the L3 code; CSR submission on your behalf | You cannot write to the intake bucket; we submit CSRs for you. The Statement of Work names `mobile-wallet-verifier-csr` for this area; the live validation is in `mobile-wallet-verifier-certificate-signing-requests` (4.5) |
| **5. Trust artefact publication, integrity and security** | Configuration; Lambda code; Scenario | Section 2.2; 6.2 *Controls* and items 1 and 2; 6.1 items 5 and 7; 6.5 *What is not covered*; 6.8 (the Root CA certificate store in GitHub); section 9.6 | Ceremony record | Write paths are established, not exercised |
| **6. Trust artefact availability and distribution resilience** | Configuration | Section 2.2; 6.2 items 2, 3 and 4; section 4.3; section 7.1; the `crl-health` stack | — | No denial of service. The centrally managed WAF is not ours to authorise (4.4.1) |
| **7. API security and information disclosure** | Configuration | 6.0 *Recognising an SCP denial* and the deny checks; 6.3 items 11, 13, 17, 22, 26 and 27; 6.6 (logging); | — | The API Gateway is out of scope. This area concerns the native AWS Private CA APIs as governed by IAM, the SCP and the pipelines, and what configuration, logs and error messages disclose |
| **8. CI/CD and Infrastructure-as-Code security** | Configuration; Lambda code; IaC; GitHub; Scenario | 6.3 items 4–11; 6.1 items 3 and 4; 6.7; 6.8; sections 2.1 and 4.4.2 (`github-identity`, `signer`) | DevPlatform role extracts; repository settings export | Review is read-only in GitHub (4.4.3). You assess promotion to higher environments by reasoning only |
| **9. Audit logging and monitoring integrity** | Configuration; Lambda code; Scenario (the 6.5 window) | 6.5 (whole scenario); 6.3 items 7, 15, 16 and 28; 6.6 (the transformer) | — | You cannot see our Slack channels or telemetry; we reconcile alerts against your attempt log |

### 6.0 Coverage

### 6.1 Issuance, activation and ceremony controls

**Attempt:** obtain a certificate from any CA in the hierarchy, or activate a CA.


### 6.2 Revocation and CA state changes

**Attempt:** establish whether any certificate can be revoked, or any CA's state changed.


### 6.3 Compromising the CAs

This is the scenario we care most about, and the one where we are least confident.


### 6.4 Malformed and malicious CSRs

**Attempt:** get a CSR past our validation that should not pass, or make the validator behave badly.


### 6.5 Detection and alerting (the one scenario expected to succeed)

A denied call against a real CA is *supposed* to be noisy. We want to know whether it actually is.


### 6.6 Lambda Code Review

The Statement of Work names three Lambda codebases. All three are TypeScript on Node.js, bundled with esbuild, and deployed to the Verifier account; none runs in the Root CA account. This section tells you where each one lives.


### 6.7 Infrastructure as Code Review

Every in-scope stack is defined in one of two ways, and the distinction matters for how a change reaches Build. **Application stacks:** `root-ca`, `dvs-ca`, `verifier-csr`, `ca-expiry-monitoring` and `crl-health`. CloudFormation templates that GitHub Actions packages, signs and uploads, and that a DevPlatform secure pipeline deploys and promotes. **Base stacks and the pipelines themselves** are CloudFormation stacks orchestrated by Terraform, each gated by an enable flag in a `tfvars` file, and **Terraform is applied by hand from an operator's workstation: no repository applies Terraform from CI.** A CI/CD assessment that assumes all infrastructure changes flow through a pipeline will therefore miss the operator-applied half of the estate.

### 6.8 GitHub Repository

The GitHub workflows are the front door to every pipeline in scope. A workflow authenticates to AWS through the GitHub OIDC provider, uploads a signed SAM artefact to the pipeline's source bucket and, for `root-ca` and `dvs-ca`, builds, signs and pushes the test container image that later runs as the pipeline's test role. From that point the pipeline deploys to Build and promotes onward without manual approval (6.3). Control of a workflow run on `main` is therefore, in practice, control of what is deployed next to the CAs.




---

## 7. Known and accepted positions

Sections 7.1 to 7.7 are positions we have considered and accepted: please do not spend engagement time rediscovering them, though you are welcome to challenge the reasoning. Section 7.8 is different. It describes how we manage vulnerabilities, it is not an accepted position, and we want it assessed.

### 7.1 CRLs are served over plain HTTP

The CRL CloudFront distributions use `ViewerProtocolPolicy: allow-all`, so HTTP is permitted alongside HTTPS. This is deliberate, and follows established PKI practice: relying parties commonly fetch CRLs over plain HTTP (RFC 5280 distribution points are conventionally `http://` URIs), and some clients cannot or will not follow HTTPS for revocation data. CRLs are signed objects whose integrity does not depend on the transport. The Wallet Backend team attaches no WAF web ACL to the CRL path; Firewall Manager attaches managed rules centrally (section 4.3).

We expect this to be raised. It is an accepted trade-off, documented as such. What we *would* value is analysis of what an on-path attacker gains in practice — particularly around CRL staleness and cache behaviour.

### 7.2 ca-back is out of scope

See sections 4.4 and 4.4.2. The Statement of Work excludes the API Gateway in the Verifier account, the "backend" repository and the Test DVS Verifier CA. They are listed here so that you report neither their exclusion as an oversight nor the resources themselves as undisclosed.

### 7.3 L3 issuance is single-operator

At L3 the two-operator control is process only: a single holder of `ApprovedMobWalletCAIssueRevoke` can complete an issuance end to end, with only a typed confirmation prompt in the way. We consider that a known limitation rather than a finding, but your view on it is welcome.

**What is not accepted.** The single-operator position at the **Root** after activation, and the pipeline routes at L1 and L2, in 6.1 items 1 to 4, are **not** accepted positions; we want them tested.

### 7.4 Build is not production

Build is a non-production environment. The SCPs that matter are attached to it, and the architecture mirrors the higher environments, which is why it is a meaningful test target. But some things genuinely differ: the CA common names carry a `[BUILD]` label, the Chatbot Slack integration and some alarm wiring vary by environment, the pipeline test roles' `acm-pca` grants apply outside production only, and there is no production deployment of the Test DVS Verifier CA at all. If you find something that appears to depend on environment configuration, say so and we will check the higher environments ourselves.

### 7.5 Slack notification

### 7.6 A superseded copy of the validation rules exists

The same eleven rules exist as a second, diverged implementation in an older repository (`mobile-wallet-verifier-csr`), which has been **superseded** by the one that owns the live path (`mobile-wallet-verifier-certificate-signing-requests`). Only the `verifier-csr-csr-validator` Lambda, in the `verifier-csr` stack, gates issuance. The older repository has not yet been archived — that decision is still open with the team — so treat its validation library and its `issue-revoke-ca` CLI copy, which is marked deprecated, as dead code on the issuance path. The repository itself remains in scope for the GitHub Repository and Actions Review, because two parts of it are live: its `csr-checks.yml` workflow still runs on pull requests, and it stores Root CA certificate PEM files (section 6.8).

### 7.7 Terraform is applied by operators, not by CI

No repository applies Terraform from a pipeline; base stacks and the pipelines themselves are applied by hand by a Wallet Backend team operator with an elevated SSO session (section 6.7). We know this places a great deal of weight on operator workstations and on the entitlement to those sessions. We would value your assessment of the risk, but the absence of a Terraform pipeline is a known position rather than a discovery.

### 7.8 How we manage vulnerabilities

The Statement of Work's first objective is to confirm the effectiveness of our vulnerability assessment and management processes, so this is what exists for you to assess. It is a description, not an accepted position: tell us where it falls short.

- **Dependencies.** Dependabot is configured in all five repositories, for npm packages and for GitHub Actions. Third-party actions are pinned to commit SHAs.
- **Code and templates.** Pull requests run ESLint, unit and template tests, SonarQube analysis, `cfn-lint` and `sam validate --lint`; the infrastructure repositories also run `checkov`, `tflint` and `shellcheck` through pre-commit. Rule skips are recorded in the templates with a reason (section 6.7).
- **Container images.** The test images in the pipeline ECR repositories are scanned, and the `ecr-image-scan-findings-logger` stack records the findings.
- **Artefact integrity.** SAM artefacts and test images are signed in GitHub Actions and verified by the pipelines (section 6.8).
- **Triage and ownership.** The Wallet Backend team (assignees to the weekly rota) owns Dependabot alerts, image-scan findings and SonarQube issues; the target time to remediate by severity (Critical 7d, High 14d, etc.).
- **The AWS accounts.** Organisation-wide tooling (AWS Config conformance packs and security connectors) reports on both accounts, but it is owned centrally and is out of scope (4.4.1). *[The Wallet Backend team to complete before release: who receives and triages those findings for these two accounts, and how Lambda runtime and dependency patching is tracked.]*

The work falls mainly in the GitHub Repository and Actions Review, and section 8.2 asks for a conclusion on it.

---

## 8. Reporting


---
