#!/usr/bin/env bash
# Verifier CA CSR — Manual Deployment and Verification
#
# Usage:
#   ./local-dev/deploy-csr.sh deploy [options]
#   ./local-dev/deploy-csr.sh delete [options]
#   ./local-dev/deploy-csr.sh verify [options]
#   ./local-dev/deploy-csr.sh probe  [options]
#
#   deploy   Manual sam deploy of the dev stack. dev only.
#   delete   sam delete of the dev stack, then teardown of the two S3 buckets
#            CloudFormation orphans because they carry DeletionPolicy and
#            UpdateReplacePolicy Retain. dev only.
#   verify   Static checks that the stack's resources and wiring are in place.
#            Reads only, safe anywhere.
#   probe    End-to-end test of the validation pipeline. Uploads the valid
#            fixture CSR and a corrupted copy of it to the received bucket,
#            waits for the validator Lambda to run, and confirms each landed
#            where it should: the good one under validated/, the corrupted one
#            under failed/. Writes real objects and triggers the Lambda, so dev
#            only. Cleans up after itself unless --keep is given.
#
# Options:
#   --env ENV                   Target environment       (default: dev)
#                               deploy and delete accept dev only
#   --stack-name NAME           CSR stack name           (default: csr)
#   --vpc-stack-name NAME       VPC stack name           (default: vpc)
#   --int-ca-stack-name NAME    Int CA backend stack name (default: ac-dvs-ca)
#   --alerting-stack-name NAME  Shared alerting stack name (default: alerting)
#   --runbook-url URL           deploy: runbook URL shown in Slack notifications
#                               (default: none; also via CSR_RUNBOOK_URL)
#   --permissions-boundary ARN  PermissionsBoundary ARN  (default: none)
#   --csr-retention-days DAYS   CSR retention in days    (default: 366)
#   --good-csr PATH             probe: PEM CSR expected to pass
#                               (default: local-dev/events/incoming/good.pem)
#   --probe-timeout SECONDS     probe: how long to wait for outcomes (default: 60)
#   --keep                      probe: leave uploaded inputs and outcome objects
#                               in place instead of cleaning them up
#   --dry-run                   deploy: build a changeset, do not execute
#                               delete: print the teardown plan, change nothing
#   --yes                       delete: skip the typed-stack-name confirmation
#   -h | --help                 Show this help
#
# Dependencies: AWS CLI v2, SAM CLI, jq
#
# History:
# Version  Date        Notes
# ------   ----------  -------------------------------------------------------------
#   1.0.0, 25-10-2026: Initial version

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

REGION="${CSR_REGION:-eu-west-2}"
TEMPLATE="template.yaml"
ENVIRONMENT="${CSR_ENV:-dev}"
STACK_NAME="${CSR_STACK:-csr}"
VPC_STACK_NAME="${VPC_STACK:-vpc}"
INT_CA_STACK_NAME="${INT_CA_STACK:-ac-dvs-ca}"
ALERTING_STACK_NAME="${ALERTING_STACK:-alerting}"
NOTIFICATION_RUNBOOK_URL="${CSR_RUNBOOK_URL:-}"
PERMISSIONS_BOUNDARY="none"
CSR_RETENTION_DAYS=366
GOOD_CSR="${SCRIPT_DIR}/events/incoming/good.pem"
PROBE_TIMEOUT=60
PROBE_KEEP=false
DRY_RUN=false
CONFIRM_DELETE=true
COMMAND=""
DELETE_FAILURES=0
DELETE_STACK_ID=""
DELETE_ROWS=""
NOTHING_RETAINED=false
BUCKETS_DELETED=0

csr_account_for() {
    case "$1" in
        dev)         echo "673684579794" ;;
        build)       echo "619710252082" ;;
        staging)     echo "465884402746" ;;
        integration) echo "339570694434" ;;
        prod)        echo "302340064069" ;;
        *)           echo "" ;;
    esac
}

if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; DIM='\033[2m'; NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' DIM='' NC=''
fi

print_header() {
    echo -e "\n${BLUE}###############################################${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}###############################################${NC}\n"
}
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error()   { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}! $1${NC}"; }
print_info()    { echo -e "${DIM}  $1${NC}"; }

usage() {
    awk 'NR==1 { next }
         /^# ={10,}/ { n++; if (n==3) exit; next }
         /^#/ { sub(/^# ?/, ""); print; next }
         { exit }' "${BASH_SOURCE[0]}"
}

parse_args() {
    if [[ $# -eq 0 ]]; then usage; exit 1; fi
    COMMAND="$1"; shift

    case "$COMMAND" in
        deploy|delete|verify|probe) ;;
        -h|--help) usage; exit 0 ;;
        *) print_error "Unknown command: $COMMAND"; usage; exit 1 ;;
    esac

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --env)                  ENVIRONMENT="$2"; shift 2 ;;
            --stack-name)           STACK_NAME="$2"; shift 2 ;;
            --vpc-stack-name)       VPC_STACK_NAME="$2"; shift 2 ;;
            --int-ca-stack-name)    INT_CA_STACK_NAME="$2"; shift 2 ;;
            --alerting-stack-name)  ALERTING_STACK_NAME="$2"; shift 2 ;;
            --runbook-url)          NOTIFICATION_RUNBOOK_URL="$2"; shift 2 ;;
            --permissions-boundary) PERMISSIONS_BOUNDARY="$2"; shift 2 ;;
            --csr-retention-days)   CSR_RETENTION_DAYS="$2"; shift 2 ;;
            --good-csr)             GOOD_CSR="$2"; shift 2 ;;
            --probe-timeout)        PROBE_TIMEOUT="$2"; shift 2 ;;
            --keep)                 PROBE_KEEP=true; shift ;;
            --yes)                  CONFIRM_DELETE=false; shift ;;
            --dry-run)              DRY_RUN=true; shift ;;
            -h|--help)              usage; exit 0 ;;
            *) print_error "Unknown option: $1"; usage; exit 1 ;;
        esac
    done

    case "$ENVIRONMENT" in
        dev|build|staging|integration|prod) ;;
        *) print_error "Invalid --env '$ENVIRONMENT' (dev|build|staging|integration|prod)"; exit 1 ;;
    esac

    assert_dev_only_command
    if [[ "$COMMAND" == "deploy" || "$COMMAND" == "delete" ]]; then
        validate_numeric_parameters
    fi
    if [[ "$COMMAND" == "probe" ]]; then
        validate_probe_parameters
    fi
}

assert_dev_only_command() {
    case "$COMMAND" in
        deploy|delete|probe) ;;
        *) return 0 ;;
    esac
    if [[ "$ENVIRONMENT" != "dev" ]]; then
        print_error "'$COMMAND' runs in dev only, not $ENVIRONMENT."
        print_info "The GDS sam-deploy-pipeline owns $ENVIRONMENT — deploy and delete there through it."
        print_info "verify is available in $ENVIRONMENT."
        exit 1
    fi
}

validate_numeric_parameters() {
    if [[ ! "$CSR_RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
        print_error "--csr-retention-days must be a positive integer, got '$CSR_RETENTION_DAYS'"
        exit 1
    fi
}

validate_probe_parameters() {
    if [[ ! "$PROBE_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
        print_error "--probe-timeout must be a positive integer (seconds), got '$PROBE_TIMEOUT'"
        exit 1
    fi
    if [[ ! -f "$GOOD_CSR" ]]; then
        print_error "--good-csr file not found: $GOOD_CSR"
        exit 1
    fi
}

# Preflight
require_tools() {
    local missing=0
    for tool in aws jq; do
        command -v "$tool" >/dev/null 2>&1 || { print_error "$tool not found"; missing=1; }
    done
    if [[ "$COMMAND" == "deploy" ]] \
        || [[ "$COMMAND" == "delete" && "$DRY_RUN" == false ]]; then
        command -v sam >/dev/null 2>&1 || { print_error "sam not found"; missing=1; }
    fi
    if [[ "$COMMAND" == "probe" ]]; then
        command -v openssl >/dev/null 2>&1 || { print_error "openssl not found"; missing=1; }
    fi
    [[ $missing -eq 0 ]] || exit 1
}

assert_correct_account() {
    local expected actual
    expected="$(csr_account_for "$ENVIRONMENT")"
    if ! actual="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"; then
        print_error "No AWS credentials. Authenticate against the CSR $ENVIRONMENT account first."
        exit 1
    fi
    if [[ "$actual" != "$expected" ]]; then
        print_error "Wrong account: authenticated as $actual, expected $expected (CSR $ENVIRONMENT)."
        print_info "Check your AWS profile — this stack lives in the Verifier ca-infra account."
        exit 1
    fi
    print_success "Account $actual (CSR $ENVIRONMENT)"
}

aws_read() {
    local out
    if out="$(aws "$@" 2>&1)"; then printf '%s' "$out"; return 0; fi
    case "$out" in
        *"does not exist"*|*NotFound*|*"Not Found"*|*NoSuchBucket*|*"(404)"*) return 2 ;;
    esac
    printf '%s\n' "$out" >&2
    return 1
}

do_deploy() {
    print_header "Deploying $STACK_NAME to $ENVIRONMENT"
    assert_correct_account

    print_info "VPC stack:        $VPC_STACK_NAME"
    print_info "Int CA stack:     $INT_CA_STACK_NAME"
    print_info "IssuedCerts import: ${INT_CA_STACK_NAME}-IssuedCertsBucketName"
    print_info "Alerting stack:   $ALERTING_STACK_NAME"
    assert_alerting_dependencies

    cd "$PROJECT_ROOT"
    print_info "sam build --template $TEMPLATE"
    sam build --template "$TEMPLATE" >/dev/null

    local deploy_args=(
        --stack-name "$STACK_NAME"
        --region "$REGION"
        --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND
        --no-fail-on-empty-changeset
        --resolve-s3
        --parameter-overrides
            "Environment=$ENVIRONMENT"
            "VpcStackName=$VPC_STACK_NAME"
            "DvsStackName=$INT_CA_STACK_NAME"
            "AlertingStackName=$ALERTING_STACK_NAME"
            "PermissionsBoundary=$PERMISSIONS_BOUNDARY"
            "CsrRetentionDays=$CSR_RETENTION_DAYS"
    )
    if [[ "$DRY_RUN" == true ]]; then
        deploy_args+=(--no-execute-changeset)
        print_warning "Dry run — changeset created but not executed"
    fi

    sam deploy "${deploy_args[@]}"
    print_success "Deploy complete"
}

assert_alerting_dependencies() {
    local ssm_name="/${ENVIRONMENT}/Alerting/WarningTopicArn"
    local value rc=0

    value="$(aws_read ssm get-parameter --name "$ssm_name" --region "$REGION" \
        --query 'Parameter.Value' --output text)" || rc=$?
    if [[ "$rc" -eq 0 && -n "$value" && "$value" != "None" ]]; then
        print_success "Alerting topic SSM param $ssm_name -> $value"
        return 0
    fi

    print_error "Alerting topic SSM param $ssm_name not found"
    print_info "The validator publishes CSR outcomes to the shared alerting stack's"
    print_info "warning topic. Deploy that stack first (it writes this SSM parameter),"
    print_info "or pass --alerting-stack-name if it is named differently."
    exit 1
}

# delete
delete_fail() { print_error "$1"; DELETE_FAILURES=$((DELETE_FAILURES + 1)); }

template_retained_resources() {
    local tpl="${PROJECT_ROOT}/${TEMPLATE}"
    [[ -f "$tpl" ]] || return 0
    awk -v q="'" '
        /^Resources:/ { inres = 1; next }
        /^[A-Za-z]/   { inres = 0 }
        !inres        { next }
        /^  [A-Za-z0-9]+:([[:space:]]*(#.*)?)?$/ {
            if (retain && type != "") print logical "\t" type
            logical = $1; sub(/:$/, "", logical); type = ""; retain = 0; next
        }
        /^    Type:[[:space:]]/ { type = $2; gsub("[\"" q "]", "", type) }
        /^    DeletionPolicy:.*Retain/ { retain = 1 }
        END { if (retain && type != "") print logical "\t" type }
    ' "$tpl"
}

resolve_stack_id() {
    local id rc=0
    id="$(aws_read cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
        --query 'Stacks[0].StackId' --output text)" || rc=$?
    case "$rc" in
        0) echo "$id"; return 0 ;;
        1) print_error "Could not read stack $STACK_NAME — not proceeding on a guess." >&2; return 1 ;;
    esac
    id="$(aws_read cloudformation list-stacks --region "$REGION" --stack-status-filter DELETE_COMPLETE \
        --query "sort_by(StackSummaries[?StackName=='${STACK_NAME}'], &DeletionTime)[-1].StackId" \
        --output text)" || { print_error "Could not list deleted stacks." >&2; return 1; }
    echo "$id"
}

stack_status_of() {
    aws_read cloudformation describe-stacks --stack-name "$1" --region "$REGION" \
        --query 'Stacks[0].StackStatus' --output text
}

stack_resources_json() {
    aws_read cloudformation list-stack-resources --stack-name "$1" --region "$REGION" --output json
}

assert_not_termination_protected() {
    local protected
    protected="$(aws_read cloudformation describe-stacks --stack-name "$1" --region "$REGION" \
        --query 'Stacks[0].EnableTerminationProtection' --output text)" \
        || { print_error "Could not read termination protection on $STACK_NAME — treating it as on."; exit 1; }
    if [[ "$protected" == "True" || "$protected" == "true" ]]; then
        print_error "Stack $STACK_NAME is termination-protected — refusing to delete it."
        print_info "Lift it explicitly if you mean to:"
        print_info "  aws cloudformation update-termination-protection \\"
        print_info "      --no-enable-termination-protection --stack-name $STACK_NAME --region $REGION"
        exit 1
    fi
    print_success "Termination protection is off on $STACK_NAME"
}

retained_physical_ids() {
    local resources="$1" logical type physical
    while IFS=$'\t' read -r logical type; do
        [[ -n "$logical" ]] || continue
        physical="$(jq -r --arg l "$logical" '
            .StackResourceSummaries[]? | select(.LogicalResourceId == $l) | .PhysicalResourceId // empty' \
            <<<"$resources")"
        printf '%s\t%s\t%s\n' "$logical" "$type" "$physical"
    done < <(template_retained_resources)
}

assert_stack_matches_template() {
    local resources="$1" rows="$2" logical type physical count
    count="$(jq '(.StackResourceSummaries // []) | length' <<<"$resources" 2>/dev/null || echo 0)"
    if [[ "$count" -eq 0 ]]; then
        print_warning "Stack $STACK_NAME lists no resources (rolled back on create, or empty)."
        print_info "Nothing retained to protect — allowing the delete to remove the empty stack."
        return 0
    fi
    while IFS=$'\t' read -r logical type physical; do
        [[ -n "$logical" ]] || continue
        if jq -e --arg l "$logical" '.StackResourceSummaries[]? | select(.LogicalResourceId == $l)' \
            <<<"$resources" >/dev/null; then
            return 0
        fi
    done <<<"$rows"
    print_error "Stack $STACK_NAME declares none of ${TEMPLATE}'s retained resources — it is not a CSR stack."
    print_info "Check --stack-name (or CSR_STACK). Nothing was deleted."
    exit 1
}

warn_if_nothing_retained() {
    local rows="$1" logical type physical
    while IFS=$'\t' read -r logical type physical; do
        if [[ -n "$physical" ]]; then return 0; fi
    done <<<"$rows"
    NOTHING_RETAINED=true
    print_warning "None of the retained resources exists in this stack (never created, or it rolled back)."
    print_info "Deleting it removes nothing retained. If a rebuild failed on 'bucket already exists',"
    print_info "the orphans belong to an earlier stack named $STACK_NAME; find its ID with"
    print_info "  aws cloudformation list-stacks --stack-status-filter DELETE_COMPLETE --region $REGION"
    print_info "and clean those up by hand — this script resolves one stack by name."
}

print_delete_plan() {
    local rows="$1" logical type physical
    printf '  %-24s %s\n' "Stack"       "$STACK_NAME"
    printf '  %-24s %s\n' "Region"      "$REGION"
    printf '  %-24s %s\n' "Environment" "$ENVIRONMENT ($(csr_account_for "$ENVIRONMENT"))"
    echo
    echo "Resources CloudFormation retains and this command would clean up:"
    while IFS=$'\t' read -r logical type physical; do
        [[ -n "$logical" ]] || continue
        printf '  %-24s %-24s %s\n' "$logical" "$type" "${physical:-<never created>}"
    done <<<"$rows"
    echo
    print_info "S3 buckets: all versions and delete markers purged, then removed — NOT reversible"
    print_info "Every CSR still inside the ${CSR_RETENTION_DAYS}-day retention window is destroyed with them."
    print_info "The two KMS keys are not retained; CloudFormation deletes them with the stack."
    echo
    warn_if_nothing_retained "$rows"
}

confirm_destruction() {
    local typed=""
    if [[ "$CONFIRM_DELETE" == false ]]; then
        print_warning "--yes given — deleting without confirmation."
        return 0
    fi
    print_warning "This destroys stack $STACK_NAME and both CSR buckets, with every CSR they hold."
    read -r -p "Type the stack name ($STACK_NAME) to continue: " typed || true
    if [[ "$typed" != "$STACK_NAME" ]]; then
        print_error "Confirmation did not match — nothing was deleted."
        exit 1
    fi
}

sam_delete_stack() {
    cd "$PROJECT_ROOT"
    print_info "sam delete --stack-name $STACK_NAME --region $REGION --no-prompts"
    if ! sam delete --stack-name "$STACK_NAME" --region "$REGION" --no-prompts; then
        print_warning "sam delete exited non-zero — reading the stack's own status"
    fi
}

print_delete_failed_events() {
    local events id reason
    events="$(aws cloudformation describe-stack-events --stack-name "$1" --region "$REGION" \
        --query 'StackEvents[?ResourceStatus==`DELETE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
        --output text 2>/dev/null || true)"
    while IFS=$'\t' read -r id reason; do
        [[ -n "$id" ]] && print_info "$id: $reason"
    done <<<"$events"
}

assert_stack_deleted() {
    local stack_id="$1" status rc=0
    status="$(stack_status_of "$stack_id")" || rc=$?
    case "$rc" in
        1)  print_error "Could not read the status of $STACK_NAME after sam delete."
            print_info "If your session expired during the delete, re-authenticate and re-run."
            exit 1 ;;
        2)  status="DELETE_COMPLETE" ;;
    esac
    if [[ "$status" == "DELETE_COMPLETE" ]]; then
        print_success "Stack $STACK_NAME deleted"
        return 0
    fi
    print_error "Stack $STACK_NAME is $status, not DELETE_COMPLETE"
    print_delete_failed_events "$stack_id"
    print_info "Retained buckets were left untouched. Fix the cause and re-run."
    exit 1
}

delete_one_page_of_versions() {
    local bucket="$1" listing payload count out errors tmp
    listing="$(aws_read s3api list-object-versions --bucket "$bucket" --max-keys 1000 --no-paginate \
        --region "$REGION" --output json)" || { printf -- '-1\n'; return 0; }
    [[ -n "$listing" ]] || listing='{}'
    payload="$(jq -c '{Objects: [ (.Versions // [])[], (.DeleteMarkers // [])[] | {Key, VersionId} ][0:1000],
        Quiet: true}' <<<"$listing" 2>/dev/null || true)"
    count="$(jq '.Objects | length' <<<"${payload:-null}" 2>/dev/null || true)"
    [[ "$count" =~ ^[1-9][0-9]*$ ]] || { printf '0\n'; return 0; }

    tmp="$(mktemp)"; echo "$payload" >"$tmp"
    out="$(aws_read s3api delete-objects --bucket "$bucket" --delete "file://$tmp" \
        --region "$REGION" --output json)" || { rm -f "$tmp"; printf -- '-1\n'; return 0; }
    rm -f "$tmp"
    [[ -n "$out" ]] || out='{}'
    errors="$(jq -r '(.Errors // []) | length' <<<"$out" 2>/dev/null || echo 1)"
    if [[ "$errors" == "0" ]]; then printf '%s\n' "$count"; else printf -- '-1\n'; fi
}

empty_versioned_bucket() {
    local bucket="$1" page total=0
    while :; do
        page="$(delete_one_page_of_versions "$bucket")"
        if [[ "$page" -eq -1 ]]; then
            delete_fail "$bucket: could not delete some object versions — see the error above (denied, expired session, or Object Lock)"
            return 1
        fi
        [[ "$page" -gt 0 ]] || break
        total=$((total + page))
        [[ "$total" -gt 1000 ]] && print_info "$bucket: $total version(s) removed so far"
    done
    print_info "$bucket: emptied ($total version(s) and delete marker(s) removed)"
}

empty_and_delete_bucket() {
    local bucket="$1" rc=0
    aws_read s3api head-bucket --bucket "$bucket" --region "$REGION" >/dev/null || rc=$?
    case "$rc" in
        2) print_warning "Bucket $bucket not found — skipping"; return 0 ;;
        1) delete_fail "Bucket $bucket exists but could not be read (denied, or now owned by another account) — left as is"; return 0 ;;
    esac
    empty_versioned_bucket "$bucket" || return 0
    if aws s3api delete-bucket --bucket "$bucket" --region "$REGION"; then
        BUCKETS_DELETED=$((BUCKETS_DELETED + 1))
        print_success "Bucket $bucket deleted"
    else
        delete_fail "Bucket $bucket could not be deleted — see the error above"
    fi
}

delete_retained_resources() {
    local rows="$1" logical type physical
    while IFS=$'\t' read -r logical type physical; do
        [[ -n "$physical" ]] || continue
        case "$type" in
            AWS::S3::Bucket) empty_and_delete_bucket "$physical" ;;
            *) print_warning "$logical ($type, $physical) is retained but has no teardown here — remove it by hand" ;;
        esac
    done <<<"$rows"
}

print_delete_summary() {
    echo
    if [[ $DELETE_FAILURES -gt 0 ]]; then
        print_error "$DELETE_FAILURES teardown step(s) failed — some resources still exist; see above"
        return 1
    fi
    if [[ "$NOTHING_RETAINED" == true ]]; then
        print_success "Stack removed; it held no retained resources to clean up"
        return 0
    fi
    print_success "Stack and both retained buckets removed ($BUCKETS_DELETED bucket(s) deleted)"
    print_info "Any operator or Int CA flow that read or wrote these buckets will fail until the stack is rebuilt."
}

prepare_delete() {
    local resources
    DELETE_STACK_ID="$(resolve_stack_id)" || exit 1
    if [[ -z "$DELETE_STACK_ID" || "$DELETE_STACK_ID" == "None" ]]; then
        print_error "No stack named $STACK_NAME in $REGION, live or deleted in the last 90 days."
        print_info "There is nothing to delete and no resource list to derive its orphans from."
        exit 1
    fi
    assert_not_termination_protected "$DELETE_STACK_ID"

    resources="$(stack_resources_json "$DELETE_STACK_ID")" \
        || { print_error "Could not list the resources of $STACK_NAME — not proceeding on a guess."; exit 1; }
    DELETE_ROWS="$(retained_physical_ids "$resources")"
    if [[ -z "$DELETE_ROWS" ]]; then
        print_error "No DeletionPolicy: Retain resources parsed from $TEMPLATE — refusing to delete blind."
        print_info "Is the working tree on the right branch, and the template where this script expects it?"
        exit 1
    fi
    assert_stack_matches_template "$resources" "$DELETE_ROWS"
    print_delete_plan "$DELETE_ROWS"
}

do_delete() {
    print_header "Deleting $STACK_NAME from $ENVIRONMENT"
    assert_correct_account
    prepare_delete

    if [[ "$DRY_RUN" == true ]]; then
        print_warning "Dry run — nothing was deleted"
        return 0
    fi
    confirm_destruction

    sam_delete_stack
    assert_stack_deleted "$DELETE_STACK_ID"

    print_header "Tearing down retained buckets"
    delete_retained_resources "$DELETE_ROWS"
    print_delete_summary
}

# verify
stack_output() {
    aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
        --output text 2>/dev/null
}

do_verify() {
    print_header "Verifying $STACK_NAME ($ENVIRONMENT)"
    assert_correct_account

    local failures=0
    local status rc=0
    status="$(stack_status_of "$STACK_NAME")" || rc=$?
    if [[ "$rc" -ne 0 ]]; then
        print_error "Stack $STACK_NAME not found in $REGION"
        print_info "Deploy it first: $0 deploy --env $ENVIRONMENT --stack-name $STACK_NAME"
        return 1
    fi
    if [[ "$status" == *COMPLETE && "$status" != ROLLBACK* ]]; then
        print_success "Stack status: $status"
    else
        print_error "Stack status: $status"; failures=$((failures+1))
    fi

    local received validated
    received="$(stack_output CsrReceivedBucketName)"
    validated="$(stack_output CsrValidatedBucketName)"
    verify_bucket "$received"  "CsrReceivedBucket"  || failures=$((failures+1))
    verify_bucket "$validated" "CsrValidatedBucket" || failures=$((failures+1))
    verify_bucket_notification "$received" || failures=$((failures+1))

    verify_function || failures=$((failures+1))
    verify_role "${STACK_NAME}-L3EnableDisableOperatorRole" || failures=$((failures+1))
    verify_role "${STACK_NAME}-L3IssueRevokeOperatorRole"   || failures=$((failures+1))
    verify_int_ca_export || failures=$((failures+1))
    verify_alerting_dependencies || failures=$((failures+1))
    verify_notification_wiring || failures=$((failures+1))

    if [[ $failures -gt 0 ]]; then
        print_error "$failures check(s) failed"
        return 1
    fi
    print_success "CSR stack verified"
}

verify_bucket() {
    local bucket="$1" label="$2"
    if [[ -z "$bucket" || "$bucket" == "None" ]]; then
        print_error "$label: output not found on $STACK_NAME"
        return 1
    fi
    if aws_read s3api head-bucket --bucket "$bucket" --region "$REGION" >/dev/null 2>&1; then
        print_success "$label -> $bucket"
        return 0
    fi
    print_error "$label $bucket does not exist or is unreadable"
    return 1
}

verify_bucket_notification() {
    local bucket="$1" fn_arns
    [[ -n "$bucket" && "$bucket" != "None" ]] || { print_error "Received bucket name unknown — skipping notification check"; return 1; }
    fn_arns="$(aws_read s3api get-bucket-notification-configuration --bucket "$bucket" --region "$REGION" \
        --query 'LambdaFunctionConfigurations[].LambdaFunctionArn' --output text)" || {
        print_error "Could not read notification config on $bucket"; return 1; }
    if [[ "$fn_arns" == *"${STACK_NAME}-csr-validator"* ]]; then
        print_success "Received bucket notifies the csr-validator alias on object creation"
        return 0
    fi
    print_error "Received bucket has no notification to ${STACK_NAME}-csr-validator"
    print_info "actual: ${fn_arns:-<none>}"
    return 1
}

verify_function() {
    local fn="${STACK_NAME}-csr-validator"
    if aws_read lambda get-function --function-name "$fn" --region "$REGION" >/dev/null 2>&1; then
        print_success "Function $fn exists"
        return 0
    fi
    print_error "Lambda function $fn not found"
    return 1
}

verify_role() {
    local role="$1"
    if aws_read iam get-role --role-name "$role" >/dev/null 2>&1; then
        print_success "Role $role exists"
        return 0
    fi
    print_error "IAM role $role not found"
    return 1
}

verify_int_ca_export() {
    local export_name="${INT_CA_STACK_NAME}-IssuedCertsBucketName" value
    value="$(aws_read cloudformation list-exports --region "$REGION" \
        --query "Exports[?Name=='${export_name}'].Value" --output text)" || {
        print_error "Could not read CloudFormation exports"; return 1; }
    if [[ -n "$value" && "$value" != "None" ]]; then
        print_success "Int CA export $export_name -> $value"
        return 0
    fi
    print_error "Int CA export $export_name not found"
    print_info "The IssueRevoke operator role depends on it. Is --int-ca-stack-name ($INT_CA_STACK_NAME) correct,"
    print_info "and is the Int CA backend stack deployed in this account?"
    return 1
}

verify_alerting_dependencies() {
    local ssm_name="/${ENVIRONMENT}/Alerting/WarningTopicArn"
    local value rc=0

    value="$(aws_read ssm get-parameter --name "$ssm_name" --region "$REGION" \
        --query 'Parameter.Value' --output text)" || rc=$?
    if [[ "$rc" -eq 0 && -n "$value" && "$value" != "None" ]]; then
        print_success "Alerting topic SSM param $ssm_name -> $value"
        return 0
    fi
    print_error "Alerting topic SSM param $ssm_name not found"
    print_info "Deploy the shared alerting stack (it writes this parameter), or pass"
    print_info "--alerting-stack-name if it is named differently."
    return 1
}

verify_notification_wiring() {
    local fn="${STACK_NAME}-csr-validator" topic_arn role_name policy_names failures=0

    topic_arn="$(aws_read lambda get-function-configuration --function-name "$fn" --region "$REGION" \
        --query 'Environment.Variables.NOTIFICATION_TOPIC_ARN' --output text)" || {
        print_error "Could not read $fn environment configuration"; return 1; }
    if [[ -n "$topic_arn" && "$topic_arn" != "None" ]]; then
        print_success "Validator NOTIFICATION_TOPIC_ARN -> $topic_arn"
    else
        print_warning "Validator NOTIFICATION_TOPIC_ARN is unset — notifications are disabled (not fatal)"
    fi

    role_name="$(aws_read lambda get-function-configuration --function-name "$fn" --region "$REGION" \
        --query 'Role' --output text)" || { print_error "Could not read $fn role"; return 1; }
    role_name="${role_name##*/}"
    policy_names="$(aws_read iam list-role-policies --role-name "$role_name" \
        --query 'PolicyNames' --output text)" || {
        print_error "Could not list inline policies on $role_name"; return 1; }
    if [[ "$policy_names" == *"CsrValidatorNotificationAccess"* ]]; then
        print_success "Validator role grants sns:Publish (CsrValidatorNotificationAccess)"
    else
        print_error "Validator role is missing the CsrValidatorNotificationAccess policy"
        failures=$((failures+1))
    fi

    [[ $failures -eq 0 ]]
}

# probe
PROBE_RECEIVED_BUCKET=""
PROBE_VALIDATED_BUCKET=""
PROBE_GOOD_INPUT_KEY=""
PROBE_BAD_INPUT_KEY=""
PROBE_GOOD_RESULT_KEY=""
PROBE_GOOD_PEM_KEY=""
PROBE_BAD_RESULT_KEY=""
PROBE_BAD_PEM_KEY=""

pem_body() {
    sed '/-----BEGIN/d; /-----END/d' "$1" | tr -d '[:space:]'
}

sha256_of_base64() {
    base64 -d 2>/dev/null | openssl dgst -sha256 | awk '{print $NF}'
}

corrupt_pem_body() {
    local body="$1" c
    c="${body:20:1}"
    if [[ "$c" == "A" ]]; then c="B"; else c="A"; fi
    printf '%s%s%s' "${body:0:20}" "$c" "${body:21}"
}

wrap_pem() {
    printf -- '-----BEGIN CERTIFICATE REQUEST-----\n'
    printf '%s' "$1" | fold -w 64
    printf -- '\n-----END CERTIFICATE REQUEST-----\n'
}

s3_object_exists() {
    local bucket="$1" key="$2" rc=0
    aws_read s3api head-object --bucket "$bucket" --key "$key" --region "$REGION" >/dev/null || rc=$?
    return "$rc"   # 0 present, 2 absent, 1 unreadable
}

wait_for_object() {
    local bucket="$1" key="$2" deadline="$3" rc
    while :; do
        s3_object_exists "$bucket" "$key"; rc=$?
        case "$rc" in
            0) return 0 ;;
            1) return 1 ;;
        esac
        [[ "$(date +%s)" -lt "$deadline" ]] || return 2
        sleep 3
    done
}

print_result_record() {
    local bucket="$1" key="$2" tmp record status violations
    tmp="$(mktemp)"
    if ! aws s3api get-object --bucket "$bucket" --key "$key" --region "$REGION" "$tmp" >/dev/null 2>&1; then
        rm -f "$tmp"; print_info "could not read $key"; return 0
    fi
    record="$(cat "$tmp")"; rm -f "$tmp"
    status="$(printf '%s' "$record" | jq -r '.status // "?"' 2>/dev/null || echo '?')"
    violations="$(printf '%s' "$record" | jq -r '(.violations // []) | length' 2>/dev/null || echo '?')"
    print_info "status: $status, violations: $violations"
    if [[ "$violations" != "0" && "$violations" != "?" ]]; then
        printf '%s' "$record" | jq -r '.violations[]? | "      - \(.rule): \(.message)"' 2>/dev/null || true
    fi
}

upload_probe_input() {
    local file="$1" bucket="$2" key="$3"
    if aws s3api put-object --bucket "$bucket" --key "$key" --body "$file" \
        --content-type "application/x-pem-file" --region "$REGION" >/dev/null 2>&1; then
        print_success "uploaded $key"
        return 0
    fi
    print_error "failed to upload $key to $bucket"
    return 1
}

cleanup_probe() {
    [[ "$PROBE_KEEP" == true ]] && { print_info "--keep: leaving probe objects in place"; return 0; }
    print_info "Cleaning up probe objects"
    local b="$PROBE_RECEIVED_BUCKET" v="$PROBE_VALIDATED_BUCKET"
    for key in "$PROBE_GOOD_INPUT_KEY" "$PROBE_BAD_INPUT_KEY"; do
        [[ -n "$key" ]] && aws s3api delete-object --bucket "$b" --key "$key" --region "$REGION" >/dev/null 2>&1 || true
    done
    for key in "$PROBE_GOOD_RESULT_KEY" "$PROBE_GOOD_PEM_KEY" \
               "$PROBE_BAD_RESULT_KEY" "$PROBE_BAD_PEM_KEY"; do
        [[ -n "$key" ]] && aws s3api delete-object --bucket "$v" --key "$key" --region "$REGION" >/dev/null 2>&1 || true
    done
}

do_probe() {
    print_header "Probing the validation pipeline on $STACK_NAME ($ENVIRONMENT)"
    assert_correct_account

    PROBE_RECEIVED_BUCKET="$(stack_output CsrReceivedBucketName)"
    PROBE_VALIDATED_BUCKET="$(stack_output CsrValidatedBucketName)"
    if [[ -z "$PROBE_RECEIVED_BUCKET" || "$PROBE_RECEIVED_BUCKET" == "None" \
        || -z "$PROBE_VALIDATED_BUCKET" || "$PROBE_VALIDATED_BUCKET" == "None" ]]; then
        print_error "Could not read bucket names from $STACK_NAME outputs — is the stack deployed?"
        exit 1
    fi
    print_info "received:  $PROBE_RECEIVED_BUCKET"
    print_info "validated: $PROBE_VALIDATED_BUCKET"

    local probe_id prefix
    probe_id="csr-probe-$(date +%s)"
    prefix="incoming/${probe_id}"
    PROBE_GOOD_INPUT_KEY="${prefix}/good.pem"
    PROBE_BAD_INPUT_KEY="${prefix}/bad.pem"

    local good_body bad_body good_sha bad_sha workdir bad_file
    good_body="$(pem_body "$GOOD_CSR")"
    if [[ -z "$good_body" ]]; then
        print_error "Could not read a PEM body from $GOOD_CSR — is it a PEM CSR?"
        exit 1
    fi
    bad_body="$(corrupt_pem_body "$good_body")"
    good_sha="$(printf '%s' "$good_body" | sha256_of_base64)"
    bad_sha="$(printf '%s' "$bad_body" | sha256_of_base64)"
    if [[ ! "$good_sha" =~ ^[0-9a-f]{64}$ || ! "$bad_sha" =~ ^[0-9a-f]{64}$ ]]; then
        print_error "Could not compute SHA-256 fingerprints for the probe inputs."
        exit 1
    fi

    PROBE_GOOD_RESULT_KEY="validated/${good_sha}.json"
    PROBE_GOOD_PEM_KEY="validated/${good_sha}.pem"
    PROBE_BAD_RESULT_KEY="failed/${bad_sha}.json"
    PROBE_BAD_PEM_KEY="failed/${bad_sha}.pem"
    print_info "good CSR sha256: $good_sha"
    print_info "bad  CSR sha256: $bad_sha (one base64 char flipped from the good one)"

    trap cleanup_probe EXIT

    print_header "Uploading probe inputs"
    workdir="$(mktemp -d)"
    bad_file="${workdir}/bad.pem"
    wrap_pem "$bad_body" > "$bad_file"

    upload_probe_input "$GOOD_CSR"  "$PROBE_RECEIVED_BUCKET" "$PROBE_GOOD_INPUT_KEY" || exit 1
    upload_probe_input "$bad_file"  "$PROBE_RECEIVED_BUCKET" "$PROBE_BAD_INPUT_KEY"  || exit 1
    rm -rf "$workdir"

    print_header "Waiting for outcomes (timeout ${PROBE_TIMEOUT}s)"
    local deadline=$(( $(date +%s) + PROBE_TIMEOUT ))
    local failures=0 good_rc bad_rc

    print_info "expecting good -> $PROBE_GOOD_RESULT_KEY"
    wait_for_object "$PROBE_VALIDATED_BUCKET" "$PROBE_GOOD_RESULT_KEY" "$deadline" && good_rc=0 || good_rc=$?
    case "$good_rc" in
        0) print_success "good CSR validated successfully (landed under validated/)"
           print_result_record "$PROBE_VALIDATED_BUCKET" "$PROBE_GOOD_RESULT_KEY" ;;
        2) print_error "good CSR outcome did not appear within ${PROBE_TIMEOUT}s"; failures=$((failures+1)) ;;
        *) print_error "could not read the validated bucket while waiting for the good outcome"; failures=$((failures+1)) ;;
    esac

    print_info "expecting bad  -> $PROBE_BAD_RESULT_KEY"
    wait_for_object "$PROBE_VALIDATED_BUCKET" "$PROBE_BAD_RESULT_KEY" "$deadline" && bad_rc=0 || bad_rc=$?
    case "$bad_rc" in
        0) print_success "bad file processed and failed (landed under failed/)"
           print_result_record "$PROBE_VALIDATED_BUCKET" "$PROBE_BAD_RESULT_KEY" ;;
        2) print_error "bad file outcome did not appear within ${PROBE_TIMEOUT}s"; failures=$((failures+1)) ;;
        *) print_error "could not read the validated bucket while waiting for the bad outcome"; failures=$((failures+1)) ;;
    esac

    echo
    if [[ $failures -gt 0 ]]; then
        print_error "$failures of 2 probe case(s) failed"
        print_info "Check the validator logs: aws logs tail /aws/lambda/${STACK_NAME}-csr-validator --region $REGION --since 10m"
        return 1
    fi

    report_notification_status
    print_success "Pipeline probe passed: good -> validated/, bad -> failed/"
}

report_notification_status() {
    local log_group="/aws/lambda/${STACK_NAME}-csr-validator" lines
    print_info "Checking notification status in $log_group"
    lines="$(aws logs tail "$log_group" --region "$REGION" --since 10m 2>/dev/null \
        | grep -oE 'CSR_VALIDATOR_NOTIFY_(SUCCESS|FAILURE|SKIPPED)' | tail -n 1)" || true
    case "$lines" in
        *SUCCESS) print_success "Notification published to SNS (at least one CSR_VALIDATOR_NOTIFY_SUCCESS)" ;;
        *FAILURE) print_warning "Notification publish failed (CSR_VALIDATOR_NOTIFY_FAILURE) — check the SNS VPC endpoint, topic policy, and KMS grant" ;;
        *SKIPPED) print_warning "Notification skipped (CSR_VALIDATOR_NOTIFY_SKIPPED) — NOTIFICATION_TOPIC_ARN is unset" ;;
        *)        print_info "No notification log line seen yet (logs may lag, or log:tail is unavailable)" ;;
    esac
}

main() {
    parse_args "$@"
    require_tools
    case "$COMMAND" in
        deploy) do_deploy ;;
        delete) do_delete ;;
        verify) do_verify ;;
        probe)  do_probe ;;
    esac
}

main "$@"
