/**
 * Measures the context cost of layout_bpmn_diagram's response on a typical
 * build sequence (create -> chain -> connect -> layout -> export), comparing
 * the default (compact) response against verbose: true.
 *
 * See #7: every mutating tool response consumes context, and
 * layout_bpmn_diagram returned large diagnostic payloads (qualityMetrics
 * flow-ID lists, full containerSizingIssues, association ID lists, an
 * uncapped nextSteps array) on every call. These now require verbose: true.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElementChain,
  handleCreateParticipant,
  handleCreateLanes,
  handleLayoutDiagram,
} from '../../../src/handlers';
import { clearDiagrams, parseResult } from '../../helpers';

beforeEach(() => clearDiagrams());

/** Build a diagram with a pool, undersized lanes, and a gateway fan-out —
 * enough structure to populate qualityMetrics, laneCrossingMetrics, and
 * containerSizingIssues so the compact/verbose difference is measurable. */
async function buildTypicalDiagram(): Promise<string> {
  const diagramId = await handleCreateDiagram({ name: 'Response Size Test' }).then(
    (r) => parseResult(r).diagramId as string
  );

  const poolRes = parseResult(
    await handleCreateParticipant({ diagramId, name: 'Order Process', height: 150, width: 300 })
  );
  const participantId = poolRes.participantId as string;

  const laneRes = parseResult(
    await handleCreateLanes({
      diagramId,
      participantId,
      lanes: [{ name: 'Requester' }, { name: 'Approver' }],
    })
  );
  const [lane1, lane2] = laneRes.laneIds as string[];

  await handleAddElementChain({
    diagramId,
    participantId,
    elements: [
      { elementType: 'bpmn:StartEvent', name: 'Start', laneId: lane1 },
      { elementType: 'bpmn:ExclusiveGateway', name: 'Approved?', laneId: lane2 },
      { elementType: 'bpmn:UserTask', name: 'Path A', laneId: lane1 },
      { elementType: 'bpmn:UserTask', name: 'Path B', laneId: lane2 },
      { elementType: 'bpmn:EndEvent', name: 'End', laneId: lane1 },
    ],
  });

  return diagramId;
}

describe('layout_bpmn_diagram response size (#7)', () => {
  test('default (compact) response is smaller than verbose', async () => {
    const diagramId = await buildTypicalDiagram();

    const compactResult = await handleLayoutDiagram({ diagramId });
    const compactBytes = Buffer.byteLength(compactResult.content[0].text as string, 'utf8');

    // Re-run so both calls see an already-laid-out diagram (deterministic).
    const verboseResult = await handleLayoutDiagram({ diagramId, verbose: true });
    const verboseBytes = Buffer.byteLength(verboseResult.content[0].text as string, 'utf8');

    expect(compactBytes).toBeLessThan(verboseBytes);
  });

  test('default response omits bulk diagnostics that verbose includes', async () => {
    const diagramId = await buildTypicalDiagram();

    const compact = parseResult(await handleLayoutDiagram({ diagramId }));
    const verbose = parseResult(await handleLayoutDiagram({ diagramId, verbose: true }));

    // Compact keeps the small, always-actionable summary fields.
    expect(typeof compact.qualityMetrics.orthogonalFlowPercent).toBe('number');
    expect(compact.qualityMetrics.nonOrthogonalFlowIds).toBeUndefined();
    expect(compact.containerSizingIssues).toBeUndefined();
    expect(compact.nextSteps.length).toBeLessThanOrEqual(2);
    if (compact.laneCrossingMetrics) {
      expect(compact.laneCrossingMetrics.crossingFlowIds).toBeUndefined();
    }

    // Verbose restores the full diagnostic detail.
    expect(verbose.nextSteps.length).toBeGreaterThanOrEqual(compact.nextSteps.length);
  });

  test('nextSteps is capped to 2 entries by default across a build sequence', async () => {
    const diagramId = await buildTypicalDiagram();
    const result = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(result.nextSteps.length).toBeLessThanOrEqual(2);
  });
});
