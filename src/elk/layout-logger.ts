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
 * This module intentionally has no dependencies on bpmn-js or elkjs so it
 * can be imported without side effects in any pipeline file.
 */

/** Whether debug logging is enabled. Checked once at module load time. */
const DEBUG_ENABLED: boolean =
  process.env['BPMN_MCP_LAYOUT_DEBUG'] === '1' || process.env['BPMN_MCP_LAYOUT_DEBUG'] === 'true';

/** A single recorded pipeline step entry. */
export interface LayoutLogEntry {
  /** Step name (e.g. 'applyNodePositions'). */
  step: string;
  /** Elapsed time for this step in milliseconds. */
  durationMs: number;
  /** Optional notes attached to this step (decisions, element counts, etc.). */
  notes: string[];
}

/**
 * Structured logger for the layout pipeline.
 *
 * Create one instance per `elkLayout()` call and thread it through the
 * pipeline context so each step can attach notes without coupling to a
 * global logger.
 *
 * All methods are no-ops when debug mode is disabled, incurring minimal
 * overhead in production.
 */
export class LayoutLogger {
  private readonly pipelineName: string;
  private readonly startTime: number;
  private readonly entries: LayoutLogEntry[] = [];
  private currentStep: string | null = null;
  private currentStepStart: number = 0;
  private currentNotes: string[] = [];

  constructor(pipelineName: string) {
    this.pipelineName = pipelineName;
    this.startTime = Date.now();
  }

  /**
   * Begin a named pipeline step.  Must be paired with `endStep()`.
   * Prefer `step()` for synchronous steps or `stepAsync()` for async ones.
   */
  beginStep(name: string): void {
    if (!DEBUG_ENABLED) return;
    this.currentStep = name;
    this.currentStepStart = Date.now();
    this.currentNotes = [];
  }

  /**
   * End the current pipeline step and record its duration.
   */
  endStep(): void {
    if (!DEBUG_ENABLED || !this.currentStep) return;
    const durationMs = Date.now() - this.currentStepStart;
    this.entries.push({
      step: this.currentStep,
      durationMs,
      notes: [...this.currentNotes],
    });
    this.emit(
      `  [${this.currentStep}] ${durationMs}ms${this.currentNotes.length ? ' — ' + this.currentNotes.join('; ') : ''}`
    );
    this.currentStep = null;
    this.currentNotes = [];
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
   * Attach a note to the current step (or log a standalone note if no step
   * is active).  Notes are recorded with the step and printed at `endStep`.
   *
   * @param context - The step or context name (for standalone notes).
   * @param message - The note text (decisions, counts, etc.).
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
   * Entries are always collected regardless of debug mode.
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
