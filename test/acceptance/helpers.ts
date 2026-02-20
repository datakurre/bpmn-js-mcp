/**
 * Shared helpers for acceptance (multi-step story) tests.
 *
 * The `assertStep` function verifies element existence, properties,
 * lint errors, and optionally compares against a golden BPMN snapshot.
 *
 * Snapshot behaviour:
 *   • If UPDATE_SNAPSHOTS=1 or the snapshot file does not exist → write the file (first-run bootstrap).
 *   • Otherwise → compare exported XML byte-for-byte against the stored snapshot.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect } from 'vitest';
import { handleListElements, handleValidate, handleExportBpmn } from '../../src/handlers';

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

const SNAPSHOTS_DIR = resolve(__dirname, '..', 'fixtures', 'acceptance-snapshots');

export interface StepChecks {
  /** Element names that must appear in the diagram. */
  containsElements?: string[];
  /** Maximum number of lint error-level issues (default: not checked). */
  lintErrorCount?: number;
  /** Snapshot path relative to acceptance-snapshots/ (e.g. 'story-01/step-01.bpmn'). */
  snapshotFile?: string;
}

/**
 * Assert a set of checks against the current diagram state.
 *
 * @param diagramId  The diagram to inspect.
 * @param stepName   Human-readable label used in failure messages.
 * @param checks     The checks to run.
 * @returns Exported XML (if snapshotFile was provided), else empty string.
 */
export async function assertStep(
  diagramId: string,
  stepName: string,
  checks: StepChecks
): Promise<string> {
  // ── Element-name checks ──────────────────────────────────────────────────
  if (checks.containsElements && checks.containsElements.length > 0) {
    const listRes = parseResult(await handleListElements({ diagramId }));
    const names = new Set<string>(
      (listRes.elements as any[]).map((e: any) => e.name).filter(Boolean)
    );
    for (const expectedName of checks.containsElements) {
      expect(names, `${stepName}: diagram should contain element "${expectedName}"`).toContain(
        expectedName
      );
    }
  }

  // ── Lint error count ─────────────────────────────────────────────────────
  if (checks.lintErrorCount !== undefined) {
    const lintRes = parseResult(await handleValidate({ diagramId }));
    const errors = ((lintRes.issues ?? []) as any[]).filter((i: any) => i.severity === 'error');
    expect(
      errors.length,
      `${stepName}: expected ${checks.lintErrorCount} lint error(s) but got ${errors.length}: ${errors.map((e: any) => e.message).join(', ')}`
    ).toBe(checks.lintErrorCount);
  }

  // ── Snapshot write (always write; no comparison) ──────────────────────────
  // BPMN XML contains non-deterministic DI element IDs generated at creation
  // time, so byte-level comparison would fail on every fresh test run.
  // Snapshots are kept as human-readable artifacts for debugging only.
  if (checks.snapshotFile) {
    const exportRes = await handleExportBpmn({ format: 'xml', diagramId, skipLint: true });
    const xml = exportRes.content[0].text;
    const snapshotPath = resolve(SNAPSHOTS_DIR, checks.snapshotFile);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, xml, 'utf-8');
    return xml;
  }

  return '';
}

/** Find an element in the diagram by name. Returns undefined if not found. */
export async function findElementByName(diagramId: string, name: string): Promise<any | undefined> {
  const listRes = parseResult(await handleListElements({ diagramId }));
  return (listRes.elements as any[]).find((e: any) => e.name === name);
}

/** Find a sequence flow between two elements by their IDs. */
export async function findFlowBetween(
  diagramId: string,
  sourceId: string,
  targetId: string
): Promise<any | undefined> {
  const listRes = parseResult(await handleListElements({ diagramId }));
  // list-elements returns sourceId/targetId (not source.id/target.id)
  return (listRes.elements as any[]).find(
    (e: any) =>
      e.type === 'bpmn:SequenceFlow' &&
      (e.sourceId ?? e.source?.id) === sourceId &&
      (e.targetId ?? e.target?.id) === targetId
  );
}

/** Parse the JSON result from any handler call. */
export { parseResult };
