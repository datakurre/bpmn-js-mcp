/**
 * Deterministic layout for trivial BPMN diagrams.
 *
 * Handles two patterns without invoking ELK:
 * 1. **Linear chains**: Start → Task → Task → … → End
 * 2. **Single split-merge**: Start → Gateway → [parallel tasks] → Gateway → End
 *
 * Produces a clean left-to-right layout with fixed, predictable positioning
 * that doesn't vary between runs.
 */

import type { DiagramState } from '../types';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import { STANDARD_BPMN_GAP, getElementSize } from '../constants';

/** Origin offset for deterministic layout. */
const ORIGIN_X = 180;
const ORIGIN_Y = 200;
const LAYER_GAP = STANDARD_BPMN_GAP + 60; // 110px between layer centres
const BRANCH_GAP = STANDARD_BPMN_GAP + 30; // 80px between branch centres

// ── Topology detection ──────────────────────────────────────────────────────

interface FlowNode {
  element: BpmnElement;
  outgoing: BpmnElement[]; // sequence flow connections
  incoming: BpmnElement[]; // sequence flow connections
}

function isFlowElement(type: string): boolean {
  return (
    type.includes('Task') ||
    type.includes('Event') ||
    type.includes('Gateway') ||
    type.includes('SubProcess') ||
    type === 'bpmn:CallActivity'
  );
}

function isConnection(type: string): boolean {
  return (
    type.includes('SequenceFlow') || type.includes('MessageFlow') || type.includes('Association')
  );
}

function isInfrastructure(type: string): boolean {
  return type === 'bpmn:Participant' || type === 'bpmn:Lane' || type === 'bpmn:Process';
}

function buildFlowGraph(elementRegistry: ElementRegistry): Map<string, FlowNode> {
  const allElements: BpmnElement[] = elementRegistry.getAll();
  const graph = new Map<string, FlowNode>();

  // Build nodes
  for (const el of allElements) {
    if (isFlowElement(el.type) && !isConnection(el.type) && !isInfrastructure(el.type)) {
      graph.set(el.id, {
        element: el,
        outgoing: [],
        incoming: [],
      });
    }
  }

  // Build edges from sequence flows
  for (const el of allElements) {
    if (el.type === 'bpmn:SequenceFlow' && el.source && el.target) {
      const src = graph.get(el.source.id);
      const tgt = graph.get(el.target.id);
      if (src) src.outgoing.push(el);
      if (tgt) tgt.incoming.push(el);
    }
  }

  return graph;
}

/** Detect if the graph is a simple linear chain. */
function detectLinearChain(graph: Map<string, FlowNode>): BpmnElement[] | null {
  if (graph.size < 2) return null;

  // Find start node (no incoming flows)
  const startNodes = [...graph.values()].filter((n) => n.incoming.length === 0);
  if (startNodes.length !== 1) return null;

  // Walk the chain
  const chain: BpmnElement[] = [];
  const visited = new Set<string>();
  let current: FlowNode | undefined = startNodes[0];

  while (current) {
    if (visited.has(current.element.id)) return null; // cycle
    visited.add(current.element.id);
    chain.push(current.element);

    if (current.outgoing.length === 0) break;
    if (current.outgoing.length > 1) return null; // branching

    const nextId = current.outgoing[0].target?.id;
    if (!nextId) break;
    const next = graph.get(nextId);
    if (!next) break;
    if (next.incoming.length > 1) return null; // merging
    current = next;
  }

  // All nodes must be in the chain
  if (chain.length !== graph.size) return null;

  return chain;
}

/** Detect if the graph is a single split-merge pattern. */
function detectSingleSplitMerge(graph: Map<string, FlowNode>): {
  prefix: BpmnElement[];
  forkGateway: BpmnElement;
  branches: BpmnElement[][];
  joinGateway: BpmnElement;
  suffix: BpmnElement[];
} | null {
  if (graph.size < 4) return null;

  // Find start node
  const startNodes = [...graph.values()].filter((n) => n.incoming.length === 0);
  if (startNodes.length !== 1) return null;

  // Walk prefix (linear part before fork)
  const prefix: BpmnElement[] = [];
  let current: FlowNode | undefined = startNodes[0];
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current.element.id)) return null;
    visited.add(current.element.id);
    prefix.push(current.element);

    if (current.outgoing.length === 0) return null; // no fork found
    if (current.outgoing.length > 1) break; // found the fork

    const nextId = current.outgoing[0].target?.id;
    if (!nextId) return null;
    const next = graph.get(nextId);
    if (!next) return null;
    if (next.incoming.length > 1) return null; // unexpected merge
    current = next;
  }

  if (!current || current.outgoing.length < 2) return null;

  const forkGateway = current.element;
  if (!forkGateway.type.includes('Gateway')) return null;

  // Walk each branch to find the merge point
  const branches: BpmnElement[][] = [];
  let joinGatewayId: string | null = null;

  for (const flow of current.outgoing) {
    const targetId = flow.target?.id;
    if (!targetId) return null;

    const branch: BpmnElement[] = [];
    let branchNode = graph.get(targetId);

    while (branchNode) {
      if (visited.has(branchNode.element.id)) {
        // This is the merge gateway (visited by another branch)
        if (!joinGatewayId) return null; // first branch shouldn't hit visited
        if (branchNode.element.id !== joinGatewayId) return null; // branches merge at different points
        break;
      }

      // Check if this is the merge point (multiple incoming from our branches)
      if (branchNode.incoming.length > 1 && branchNode.element.type.includes('Gateway')) {
        if (!joinGatewayId) {
          joinGatewayId = branchNode.element.id;
        } else if (joinGatewayId !== branchNode.element.id) {
          return null; // different merge points
        }
        break;
      }

      visited.add(branchNode.element.id);
      branch.push(branchNode.element);

      if (branchNode.outgoing.length !== 1) return null; // branch splits further
      const nextId = branchNode.outgoing[0].target?.id;
      if (!nextId) return null;
      branchNode = graph.get(nextId);
    }

    branches.push(branch);
  }

  if (!joinGatewayId) return null;
  const joinNode = graph.get(joinGatewayId);
  if (!joinNode) return null;
  const joinGateway = joinNode.element;
  visited.add(joinGatewayId);

  // Walk suffix after the merge
  const suffix: BpmnElement[] = [];
  current = joinNode;
  while (current) {
    if (current.element.id !== joinGatewayId && visited.has(current.element.id)) return null;
    if (current.element.id !== joinGatewayId) visited.add(current.element.id);

    if (current.outgoing.length === 0) break;
    if (current.outgoing.length > 1) return null; // another fork

    const nextId = current.outgoing[0].target?.id;
    if (!nextId) break;
    const next = graph.get(nextId);
    if (!next) break;
    if (next.incoming.length > 1 && next.element.id !== joinGatewayId) return null;
    visited.add(next.element.id);
    suffix.push(next.element);
    current = next;
  }

  // All nodes must be accounted for
  if (visited.size !== graph.size) return null;

  return { prefix, forkGateway, branches, joinGateway, suffix };
}

// ── Layout application ──────────────────────────────────────────────────────

/**
 * Check if a diagram is "trivial" (linear chain or single split-merge)
 * and can be laid out deterministically.
 */
export function isTrivialDiagram(elementRegistry: ElementRegistry): boolean {
  const graph = buildFlowGraph(elementRegistry);
  return detectLinearChain(graph) !== null || detectSingleSplitMerge(graph) !== null;
}

/**
 * Apply deterministic layout to a trivial diagram.
 * Returns true if the diagram was trivial and layout was applied,
 * false if the diagram is too complex for deterministic layout.
 */
export function applyDeterministicLayout(diagram: DiagramState): boolean {
  const elementRegistry: ElementRegistry = diagram.modeler.get('elementRegistry');
  const modeling: Modeling = diagram.modeler.get('modeling');
  const graph = buildFlowGraph(elementRegistry);

  // Try linear chain first
  const chain = detectLinearChain(graph);
  if (chain) {
    applyLinearChainLayout(chain, modeling);
    return true;
  }

  // Try single split-merge
  const splitMerge = detectSingleSplitMerge(graph);
  if (splitMerge) {
    applySplitMergeLayout(splitMerge, modeling);
    return true;
  }

  return false;
}

function applyLinearChainLayout(chain: BpmnElement[], modeling: Modeling): void {
  let x = ORIGIN_X;

  for (const element of chain) {
    const size = getElementSize(element.type);
    const targetX = x;
    const targetY = ORIGIN_Y;
    const dx = targetX - (element.x ?? 0);
    const dy = targetY - (element.y ?? 0);

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      modeling.moveElements([element], { x: dx, y: dy });
    }

    x += (element.width || size.width) + LAYER_GAP;
  }
}

function applySplitMergeLayout(
  pattern: {
    prefix: BpmnElement[];
    forkGateway: BpmnElement;
    branches: BpmnElement[][];
    joinGateway: BpmnElement;
    suffix: BpmnElement[];
  },
  modeling: Modeling
): void {
  let x = ORIGIN_X;

  // Layout prefix elements
  for (const element of pattern.prefix) {
    const size = getElementSize(element.type);
    moveElement(element, x, ORIGIN_Y, modeling);
    x += (element.width || size.width) + LAYER_GAP;
  }

  // Layout fork gateway
  const forkSize = getElementSize(pattern.forkGateway.type);
  moveElement(pattern.forkGateway, x, ORIGIN_Y, modeling);
  x += (pattern.forkGateway.width || forkSize.width) + LAYER_GAP;

  // Find the max branch length to align the join gateway
  const maxBranchLayers = Math.max(...pattern.branches.map((b) => b.length), 0);

  // Layout branches
  const branchCount = pattern.branches.length;
  const totalBranchHeight =
    branchCount > 0
      ? pattern.branches.reduce((sum, branch) => {
          const maxH =
            branch.length > 0
              ? Math.max(...branch.map((el) => el.height || getElementSize(el.type).height))
              : 80;
          return sum + maxH;
        }, 0) +
        (branchCount - 1) * BRANCH_GAP
      : 0;

  let branchY = ORIGIN_Y - totalBranchHeight / 2;

  for (const branch of pattern.branches) {
    let bx = x;
    const branchMaxH =
      branch.length > 0
        ? Math.max(...branch.map((el) => el.height || getElementSize(el.type).height))
        : 80;
    const branchCenterY = branchY + branchMaxH / 2;

    for (const element of branch) {
      moveElement(element, bx, branchCenterY, modeling);
      const size = getElementSize(element.type);
      bx += (element.width || size.width) + LAYER_GAP;
    }

    branchY += branchMaxH + BRANCH_GAP;
  }

  // Layout join gateway - aligned after the longest branch
  const joinX = x + maxBranchLayers * (100 + LAYER_GAP);
  const joinSize = getElementSize(pattern.joinGateway.type);
  moveElement(pattern.joinGateway, joinX, ORIGIN_Y, modeling);

  // Layout suffix
  let suffixX = joinX + (pattern.joinGateway.width || joinSize.width) + LAYER_GAP;
  for (const element of pattern.suffix) {
    const size = getElementSize(element.type);
    moveElement(element, suffixX, ORIGIN_Y, modeling);
    suffixX += (element.width || size.width) + LAYER_GAP;
  }
}

function moveElement(
  element: BpmnElement,
  targetX: number,
  targetY: number,
  modeling: Modeling
): void {
  const dx = targetX - (element.x ?? 0);
  const dy = targetY - (element.y ?? 0);
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    modeling.moveElements([element], { x: dx, y: dy });
  }
}
