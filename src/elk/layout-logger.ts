/**
 * Structured logging for the ELK layout pipeline (J4).
 *
 * Provides a `LayoutLogger` that records decisions, timings, and element
 * counts for each pipeline step.  Logging is only active when the
 * `BPMN_MCP_LAYOUT_DEBUG` environment variable is set to `'1'` or `'true'`.
 *
 * Usage:
 * ```ts
 * const logger = new LayoutLogger('elkLayout');
 * logger.step('applyNodePositions', () => applyNodePositions(ctx));
 * logger.note('gridSnap', 'skipped — gridSnap=false');
 * logger.finish();
 * ```
 *
 * When debug mode is enabled, each step logs its name, duration (ms), and
 * any attached notes to `process.stderr`.  The final `finish()` call logs
 * the total elapsed time.
 *
 * Step entries are **always** recorded (not gated on debug mode) so that
 * tests and quality-metrics tooling can access timing data without requiring
 * the environment variable.  Only stderr emission is gated on DEBUG_ENABLED.
 *
 * ## B7 — Pipeline step delta tracking
 *
 * `stepWithDelta()` / `stepAsyncWithDelta()` snapshot element positions
 * before the step, run the step, then compute how many elements moved (by
 * more than 1 px in either axis).  The count is appended as a note in debug
 * mode and stored in the entry's `movedCount` field for metric tooling.
 *
 * This module intentionally has no dependencies on bpmn-js or elkjs so it
 * can be imported without side effects in any pipeline file.
 */

/** Whether debug logging is enabled. Checked once at module load time. */
const DEBUG_ENABLED: boolean =
  process.env['BPMN_MCP_LAYOUT_DEBUG'] === '1' || process.env['BPMN_MCP_LAYOUT_DEBUG'] === 'true';

/**
 * Position snapshot used by B7 delta tracking.
 * Maps element ID to its { x, y } position at the time of the snapshot.
 * Defined here (not in index.ts) to keep layout-logger.ts self-contained.
 */
export type PositionSnapshot = Map<string, { x: number; y: number }>;

/** A single recorded pipeline step entry. */
export interface LayoutLogEntry {
  /** Step name (e.g. 'applyNodePositions'). */
  step: string;
  /** Elapsed time for this step in milliseconds. */
  durationMs: number;
  /** Optional notes attached to this step (decisions, element counts, etc.). */
  notes: string[];
  /**
   * B7: Number of elements that moved by more than 1 px during this step.
   * Only set when the step was invoked via `stepWithDelta()` or
   * `stepAsyncWithDelta()`.  Undefined for steps without delta tracking.
   */
  movedCount?: number;
}

/**
 * Structured logger for the layout pipeline.
 *
 * Create one instance per `elkLayout()` call and thread it through the
 * pipeline context so each step can attach notes without coupling to a
 * global logger.
 *
 * Step entries are **always collected** regardless of debug mode so that
 * tests and quality-metrics tooling can inspect timing data without needing
 * `BPMN_MCP_LAYOUT_DEBUG=1`.  Only stderr output is gated on DEBUG_ENABLED.
 *
 * Delta tracking (B7) via `stepWithDelta()` / `stepAsyncWithDelta()` always
 * runs and stores results in `LayoutLogEntry.movedCount`.
 */
export class LayoutLogger {
  private readonly pipelineName: string;
  private readonly startTime: number;
  private readonly entries: LayoutLogEntry[] = [];
  private currentStep: string | null = null;
  private currentStepStart: number = 0;
  private currentNotes: string[] = [];
  private currentMovedCount: number | undefined = undefined;

  constructor(pipelineName: string) {
    this.pipelineName = pipelineName;
    this.startTime = Date.now();
  }

  /**
   * Begin a named pipeline step.  Must be paired with `endStep()`.
   * Prefer `step()` for synchronous steps or `stepAsync()` for async ones.
   *
   * Always records step start time (regardless of debug mode).
   */
  beginStep(name: string): void {
    this.currentStep = name;
    this.currentStepStart = Date.now();
    this.currentNotes = [];
    this.currentMovedCount = undefined;
  }

  /**
   * End the current pipeline step and record its duration.
   *
   * Always records the entry regardless of debug mode.  Stderr emission
   * is gated on `DEBUG_ENABLED`.
   */
  endStep(): void {
    if (!this.currentStep) return;
    const durationMs = Date.now() - this.currentStepStart;
    this.entries.push({
      step: this.currentStep,
      durationMs,
      notes: [...this.currentNotes],
      movedCount: this.currentMovedCount,
    });
    if (DEBUG_ENABLED) {
      this.emit(
        `  [${this.currentStep}] ${durationMs}ms${this.currentNotes.length ? ' — ' + this.currentNotes.join('; ') : ''}`
      );
    }
    this.currentStep = null;
    this.currentNotes = [];
    this.currentMovedCount = undefined;
  }

  /**
   * Run a synchronous function as a named pipeline step.
   * Automatically calls `beginStep` and `endStep`.
   */
  step<T>(name: string, fn: () => T): T {
    this.beginStep(name);
    try {
      return fn();
    } finally {
      this.endStep();
    }
  }

  /**
   * Run an async function as a named pipeline step.
   * Automatically calls `beginStep` and `endStep`.
   */
  async stepAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.beginStep(name);
    try {
      return await fn();
    } finally {
      this.endStep();
    }
  }

  /**
   * B7: Run a synchronous step with position-delta tracking.
   *
   * Accepts two callbacks:
   * - `snapshot()` — called before the step; returns a `PositionSnapshot`.
   * - `count(before)` — called after the step; returns how many elements
   *   moved by more than 1 px compared to the snapshot.
   *
   * The result is stored in the entry's `movedCount` field and, in debug
   * mode, appended as a `delta: N elements moved` note.
   */
  stepWithDelta<T>(
    name: string,
    fn: () => T,
    snapshot: () => PositionSnapshot,
    count: (before: PositionSnapshot) => number
  ): T {
    const before = snapshot();
    this.beginStep(name);
    try {
      const result = fn();
      const moved = count(before);
      this.currentMovedCount = moved;
      if (DEBUG_ENABLED && moved > 0) {
        this.note(name, `delta: ${moved} elements moved`);
      }
      return result;
    } finally {
      this.endStep();
    }
  }

  /**
   * B7: Run an async step with position-delta tracking.
   * Same contract as `stepWithDelta()` but for async functions.
   */
  async stepAsyncWithDelta<T>(
    name: string,
    fn: () => Promise<T>,
    snapshot: () => PositionSnapshot,
    count: (before: PositionSnapshot) => number
  ): Promise<T> {
    const before = snapshot();
    this.beginStep(name);
    try {
      const result = await fn();
      const moved = count(before);
      this.currentMovedCount = moved;
      if (DEBUG_ENABLED && moved > 0) {
        this.note(name, `delta: ${moved} elements moved`);
      }
      return result;
    } finally {
      this.endStep();
    }
  }

  /**
   * Attach a note to the current step (or log a standalone note if no step
   * is active).  Notes are recorded with the step and printed at `endStep`.
   *
   * @param context - The step or context name (for standalone notes).
   * @param message - The note text (decisions, counts, etc.).
   *
   * Note emission is gated on DEBUG_ENABLED.
   */
  note(context: string, message: string): void {
    if (!DEBUG_ENABLED) return;
    if (this.currentStep) {
      this.currentNotes.push(message);
    } else {
      this.emit(`  [${context}] ${message}`);
    }
  }

  /**
   * Finish the pipeline and log the total elapsed time.
   * Should be called at the end of `elkLayout()`.
   */
  finish(): void {
    if (!DEBUG_ENABLED) return;
    const totalMs = Date.now() - this.startTime;
    this.emit(`${this.pipelineName} complete — ${totalMs}ms total, ${this.entries.length} steps`);
  }

  /**
   * Return all recorded step entries (for testing or quality metrics).
   *
   * Entries are **always** collected regardless of debug mode, so callers
   * can inspect step names, durations, and `movedCount` values without
   * needing `BPMN_MCP_LAYOUT_DEBUG=1`.
   *
   * `notes` within each entry are only populated when debug mode is enabled.
   *
   * Note: entries are only populated when debug mode is enabled; otherwise
   * the array remains empty to avoid timing overhead in production.
   */
  getEntries(): readonly LayoutLogEntry[] {
    return this.entries;
  }

  private emit(message: string): void {
    process.stderr.write(`[layout:${this.pipelineName}] ${message}\n`);
  }
}

/**
 * Create a LayoutLogger for a given pipeline invocation.
 *
 * Returns a LayoutLogger instance.  When debug mode is disabled, all
 * methods are no-ops so there is no performance overhead.
 *
 * @param pipelineName - Label for this pipeline run (e.g. 'elkLayout', 'elkLayoutSubset').
 */
export function createLayoutLogger(pipelineName: string): LayoutLogger {
  return new LayoutLogger(pipelineName);
}
