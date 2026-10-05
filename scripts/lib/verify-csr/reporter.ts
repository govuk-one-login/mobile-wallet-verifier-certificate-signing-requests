import type { RuleId, Violation } from './types.js';

/**
 * Aggregates rule violations during a validation run. Checks call `add`
 * for each violation found; the orchestrator drains the list once all
 * checks have run, so violations are reported together rather than
 * failing fast.
 *
 * Rules are marked as evaluated via `markEvaluated` so that `finalise`
 * can distinguish "passed" from "skipped" (never reached due to early
 * exit).
 */
export class Reporter {
  private readonly items: Violation[] = [];
  private readonly evaluated = new Set<RuleId>();

  add(violation: Violation): void {
    this.items.push(violation);
    this.evaluated.add(violation.rule);
  }

  markEvaluated(...rules: RuleId[]): void {
    for (const rule of rules) {
      this.evaluated.add(rule);
    }
  }

  wasEvaluated(rule: RuleId): boolean {
    return this.evaluated.has(rule);
  }

  hasViolation(rule: RuleId): boolean {
    return this.items.some((v) => v.rule === rule);
  }

  get violations(): readonly Violation[] {
    return this.items;
  }

  get passed(): boolean {
    return this.items.length === 0;
  }
}
