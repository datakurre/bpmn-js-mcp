/**
 * TypeScript type declarations for bpmnlint.
 *
 * bpmnlint ships its own lib/types.d.ts but these are minimal re-exports
 * and augmentations for our codebase.
 */

/** A single lint report entry from bpmnlint. */
export interface LintReport {
  id: string;
  message: string;
  category: "error" | "warn" | "info" | "rule-error";
  meta?: { documentation?: { url?: string } };
}

/** Raw results from `Linter.lint()` — keyed by rule name. */
export type LintResults = Record<string, LintReport[]>;

/** Configuration object for bpmnlint. */
export interface LintConfig {
  extends?: string | string[];
  rules?: Record<string, string | number | [string | number, any]>;
}

/** Flattened lint issue for easy consumption. */
export interface FlatLintIssue {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  elementId?: string;
  documentationUrl?: string;
}
