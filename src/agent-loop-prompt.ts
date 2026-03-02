/**
 * Prompt construction for the agent-loop.
 *
 * Extracted from agent-loop-cli.ts to stay within lint line limits
 * and keep prompt logic independently testable.
 */

import type { EvalReport } from './eval/types';
import type { IterationAudit } from './agent-loop-types';

type Metrics = EvalReport['scenarios'][0]['metrics'];

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------

/**
 * Compute the penalty breakdown for each metric in a scenario.
 * Returns a human-readable string showing what's costing points.
 */
export function computePenaltyBreakdown(m: Metrics): string {
  const p: string[] = [];
  if (m.overlaps > 0) p.push(`overlaps: -${m.overlaps * 25}pts`);
  if (m.crossings > 0) p.push(`crossings: -${m.crossings * 12}pts`);
  if (m.diagonalSegments > 0) p.push(`diagonals: -${m.diagonalSegments * 2}pts`);
  if (m.bendCount > 0) p.push(`bends: -${(m.bendCount * 1.5).toFixed(1)}pts`);
  if (m.nearMisses > 0) p.push(`nearMisses: -${(m.nearMisses * 0.5).toFixed(1)}pts`);
  if (m.detourRatioAvg > 1.2) p.push(`detour: -${((m.detourRatioAvg - 1.2) * 30).toFixed(1)}pts`);
  if (m.gridSnapAvg < 1) p.push(`gridSnap: -${((1 - m.gridSnapAvg) * 10).toFixed(1)}pts`);
  if (m.horizontalMisalignments > 0) p.push(`hMisalign: -${m.horizontalMisalignments * 3}pts`);
  if (m.verticalImbalance > 0) p.push(`vImbalance: -${(m.verticalImbalance * 2).toFixed(1)}pts`);
  if (m.lintErrors > 0) p.push(`lintErrors: -${m.lintErrors * 15}pts`);
  if (m.lintWarnings > 0) p.push(`lintWarnings: -${m.lintWarnings * 3}pts`);
  return p.length > 0 ? p.join(', ') : 'none';
}

// ---------------------------------------------------------------------------
// Prompt section builders
// ---------------------------------------------------------------------------

function promptRules(): string[] {
  return [
    '## CRITICAL RULES',
    '',
    'NEVER edit these files (your changes will be rejected):',
    '  - src/eval/scenarios.ts, src/eval/score.ts, src/eval/run-eval.ts, src/eval/types.ts',
    '  - Any file outside src/ or test/',
    '',
    'ONLY edit layout engine files:',
    '  - src/rebuild/positioning.ts — element position computation',
    '  - src/rebuild/engine.ts — connection routing, main rebuild loop',
    '  - src/rebuild/container-layout.ts — pool/subprocess sizing',
    '  - src/rebuild/lane-layout.ts — lane positioning',
    '  - src/rebuild/boundary.ts — boundary event placement',
    '  - src/rebuild/patterns.ts — gateway pattern detection',
    '  - src/constants.ts — spacing/sizing constants',
    '',
    'Do NOT add npm packages. Do NOT run npm/node/git/make commands.',
    'You CAN use shell commands like cat, ls, grep, find to read files.',
    '',
  ];
}

function promptScoringFormula(): string[] {
  return [
    '## SCORING FORMULA (from src/eval/score.ts — DO NOT EDIT)',
    '',
    'Score starts at 100, penalties subtracted:',
    '  score -= overlaps × 25',
    '  score -= crossings × 12',
    '  score -= diagonalSegments × 2',
    '  score -= bendCount × 1.5',
    '  score -= nearMisses × 0.5',
    '  score -= max(0, detourRatioAvg - 1.2) × 30',
    '  score -= (1 - gridSnapAvg) × 10      ← grid = 10px',
    '  score -= horizontalMisalignments × 3',
    '  score -= verticalImbalance × 2',
    '  score -= lintErrors × 15',
    '  score -= lintWarnings × 3',
    '',
    'gridSnapAvg: for each element, x%10 and y%10 distance from grid →',
    '  0px = 1.0, 5px = 0.0. Averaged across all elements.',
    '',
  ];
}

function promptScenarioBreakdown(report: EvalReport): string[] {
  const sorted = [...report.scenarios].sort((a, b) => a.score - b.score);
  const lines: string[] = ['## CURRENT SCORES (all scenarios)', ''];

  for (const s of sorted) {
    lines.push(`### ${s.scenarioId}: ${s.name} — score=${s.score} grade=${s.grade}`);
    lines.push(`  Penalties: ${computePenaltyBreakdown(s.metrics)}`);
    if (s.artifacts?.bpmnPath) {
      lines.push(`  BPMN: ${s.artifacts.bpmnPath}`);
    }
    lines.push('');
  }
  return lines;
}

function promptMetricToCode(): string[] {
  return [
    '## METRIC → CODE MAPPING',
    '',
    '### gridSnapAvg (most common penalty)',
    'Problem: element positions have x%10 or y%10 != 0.',
    'Root cause: gateway width=50 → width/2=25 → x positions end in 5.',
    'Fix: in src/rebuild/positioning.ts, round positions to 10px grid.',
    'Example: positions.set(id, { x: Math.round(x/10)*10, y: Math.round(y/10)*10 });',
    '',
    '### bendCount',
    'Problem: ManhattanLayout creates too many waypoint bends.',
    'Fix area: src/rebuild/engine.ts resetStaleWaypoints() and layoutConnections().',
    '',
    '### detourRatioAvg',
    'Problem: connection path length > manhattan distance between endpoints.',
    'Fix: ensure resetStaleWaypoints() produces clean orthogonal hints.',
    '',
  ];
}

function promptArchitecture(): string[] {
  return [
    '## KEY ARCHITECTURE',
    '',
    'The layout engine in src/rebuild/engine.ts:rebuildLayout():',
    '1. Build flow graph from BPMN elements (topology.ts)',
    '2. Topological sort + gateway pattern detection (graph.ts, patterns.ts)',
    '3. Compute positions left-to-right (positioning.ts:computePositions)',
    '4. Move elements to computed positions (modeling.moveElements)',
    '5. Layout connections via modeling.layoutConnection (ManhattanLayout)',
    '',
    'Key: STANDARD_BPMN_GAP=50, task=100×80, event=36×36, gateway=50×50',
    'Positions are CENTER coordinates. DEFAULT_ORIGIN = { x: 180, y: 200 }',
    '',
  ];
}

function promptTools(): string[] {
  return [
    '## BPMN MCP TOOLS (for testing)',
    '',
    'Use these to inspect diagrams:',
    '1. import_bpmn_xml(filePath) — load a .bpmn file',
    '2. list_bpmn_elements(diagramId) — see positions and waypoints',
    '3. layout_bpmn_diagram(diagramId) — run layout engine',
    '4. export_bpmn(diagramId, format:"svg", filePath) — visual export',
    '',
  ];
}

function promptPreviousIterations(audits: IterationAudit[]): string[] {
  if (audits.length === 0) return [];
  const lines: string[] = ['## PREVIOUS ITERATION RESULTS (learn from these)', ''];
  for (const a of audits) {
    lines.push(`### Iteration ${a.iter}: ${a.accepted ? 'ACCEPTED' : 'REJECTED'}`);
    if (a.rejectionReason) lines.push(`  Reason: ${a.rejectionReason}`);
    if (a.changedFiles.length > 0) lines.push(`  Files: ${a.changedFiles.join(', ')}`);
    if (a.changedFiles.some((f) => f.includes('scenarios') || f.includes('score'))) {
      lines.push('  ⚠ Edited eval files — DO NOT repeat this mistake!');
    }
    lines.push('');
  }
  lines.push('DO NOT repeat failed approaches. Focus on src/rebuild/ only.', '');
  return lines;
}

function promptTask(): string[] {
  return [
    '## YOUR TASK',
    '',
    'Make the smallest edit to src/rebuild/ files that improves the eval score.',
    'The biggest opportunity is usually gridSnapAvg — snap positions to 10px.',
    '',
    'Steps:',
    '1. Read src/rebuild/positioning.ts (use cat or the view tool)',
    '2. Identify where positions are computed without grid snapping',
    '3. Add grid-snapping: Math.round(value / 10) * 10',
    '4. Edit the file with the write tool',
    '',
    'After your edit, the loop will automatically build, test, and re-evaluate.',
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildPrompt(
  report: EvalReport,
  _outputDir: string,
  previousAudits?: IterationAudit[]
): string {
  return [
    'You are improving the layout engine of a headless BPMN diagram tool.',
    'The layout engine lives in src/rebuild/ and uses bpmn-js APIs.',
    'Your edits to these TypeScript files are automatically built and evaluated.',
    '',
    ...promptRules(),
    ...promptScoringFormula(),
    ...promptScenarioBreakdown(report),
    ...promptMetricToCode(),
    ...promptArchitecture(),
    ...promptTools(),
    ...promptPreviousIterations(previousAudits ?? []),
    ...promptTask(),
  ].join('\n');
}
