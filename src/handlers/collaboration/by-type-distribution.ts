/**
 * By-type element distribution helpers.
 *
 * Categorizes BPMN flow elements into "Human Tasks" vs "Automated Tasks"
 * lanes based on their element type. Used by create_bpmn_lanes when
 * distributeStrategy is 'by-type' (merged from split_bpmn_participant_into_lanes).
 */

/** Element types classified as human/manual tasks. */
const HUMAN_TASK_TYPES = new Set([
  'bpmn:UserTask',
  'bpmn:ManualTask',
  'bpmn:Task',
  'bpmn:SubProcess',
  'bpmn:CallActivity',
]);

/** Element types classified as automated tasks. */
const AUTOMATED_TASK_TYPES = new Set([
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
]);

/** Element types that are flow-control (events, gateways). */
const FLOW_CONTROL_TYPES = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:BoundaryEvent',
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
]);

/** Non-assignable element types (structural, not flow elements). */
const NON_FLOW_TYPES = new Set(['bpmn:Lane', 'bpmn:LaneSet', 'label']);
const CONNECTION_TYPES = new Set(['bpmn:SequenceFlow', 'bpmn:MessageFlow']);

export interface LaneDef {
  name: string;
  elementIds: string[];
}

/** Get child flow elements (non-structural, non-connection) of a participant. */
export function getChildFlowElements(elementRegistry: any, participantId: string): any[] {
  return elementRegistry.filter(
    (el: any) =>
      el.parent?.id === participantId &&
      !NON_FLOW_TYPES.has(el.type) &&
      !CONNECTION_TYPES.has(el.type) &&
      !el.type?.includes('Connection')
  );
}

function findBestLaneForElement(
  elementId: string,
  allElements: any[],
  laneAssignments: Map<string, number>
): number {
  const element = allElements.find((el: any) => el.id === elementId);
  if (!element) return 0;
  const votes = new Map<number, number>();
  for (const conn of element.incoming || []) {
    const srcId = conn.source?.id;
    if (srcId && laneAssignments.has(srcId)) {
      const idx = laneAssignments.get(srcId)!;
      votes.set(idx, (votes.get(idx) || 0) + 1);
    }
  }
  for (const conn of element.outgoing || []) {
    const tgtId = conn.target?.id;
    if (tgtId && laneAssignments.has(tgtId)) {
      const idx = laneAssignments.get(tgtId)!;
      votes.set(idx, (votes.get(idx) || 0) + 1);
    }
  }
  let best = 0;
  let max = 0;
  for (const [idx, count] of votes) {
    if (count > max) {
      max = count;
      best = idx;
    }
  }
  return best;
}

function categorizeByType(elements: any[]): LaneDef[] {
  const humanTaskIds: string[] = [];
  const automatedIds: string[] = [];
  const unassigned: string[] = [];

  for (const el of elements) {
    const type = el.type || '';
    if (HUMAN_TASK_TYPES.has(type)) {
      humanTaskIds.push(el.id);
    } else if (AUTOMATED_TASK_TYPES.has(type)) {
      automatedIds.push(el.id);
    } else if (FLOW_CONTROL_TYPES.has(type)) {
      unassigned.push(el.id);
    }
  }

  const lanes: LaneDef[] = [];
  if (humanTaskIds.length > 0) lanes.push({ name: 'Human Tasks', elementIds: humanTaskIds });
  if (automatedIds.length > 0) lanes.push({ name: 'Automated Tasks', elementIds: automatedIds });

  if (lanes.length === 1) {
    lanes[0].elementIds.push(...unassigned);
    return lanes;
  }
  if (lanes.length < 2) {
    // All same type: split by position
    const sorted = [...elements].sort((a: any, b: any) => (a.y || 0) - (b.y || 0));
    const mid = Math.ceil(sorted.length / 2);
    return [
      { name: 'Primary Tasks', elementIds: sorted.slice(0, mid).map((el: any) => el.id) },
      { name: 'Secondary Tasks', elementIds: sorted.slice(mid).map((el: any) => el.id) },
    ];
  }

  // Distribute unassigned elements by connectivity
  const laneAssignments = new Map<string, number>();
  for (let i = 0; i < lanes.length; i++) {
    for (const elId of lanes[i].elementIds) laneAssignments.set(elId, i);
  }
  for (const elId of unassigned) {
    const bestLane = findBestLaneForElement(elId, elements, laneAssignments);
    lanes[bestLane].elementIds.push(elId);
    laneAssignments.set(elId, bestLane);
  }
  return lanes;
}

/** Build lane definitions by categorizing elements by their BPMN type. */
export function buildByTypeLaneDefs(elements: any[], _elementRegistry: any): LaneDef[] {
  return categorizeByType(elements);
}

/** Build the next-steps hints for the create-lanes response. */
export function buildCreateLanesNextSteps(
  distributeAssignedCount?: number
): Array<{ tool: string; description: string }> {
  const steps: Array<{ tool: string; description: string }> = [];
  if (distributeAssignedCount && distributeAssignedCount > 0) {
    steps.push({
      tool: 'layout_bpmn_diagram',
      description: 'Run layout to organize elements within their assigned lanes.',
    });
  }
  steps.push(
    {
      tool: 'add_bpmn_element',
      description:
        'Add elements to a specific lane using the laneId parameter for automatic vertical centering',
    },
    {
      tool: 'move_bpmn_element',
      description: 'Move existing elements into lanes using the laneId parameter',
    },
    {
      tool: 'assign_bpmn_elements_to_lane',
      description: 'Bulk-assign multiple existing elements to a lane',
    }
  );
  return steps;
}
