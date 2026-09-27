/**
 * @internal
 * Diagram and element lookup helpers with MCP error handling.
 *
 * Provides typed accessors that throw McpError when resources are not found.
 */

import { type ToolResult } from '../types';
import type { BpmnElement, ElementRegistry } from '../bpmn-types';
import { getDiagram, getAllDiagrams } from '../diagram-manager';
import { isPersistenceEnabled, persistDiagram } from '../persistence';
import { diagramNotFoundError, elementNotFoundError } from '../errors';

/** Look up a diagram by ID, throwing an MCP error if not found. */
export function requireDiagram(diagramId: string) {
  const diagram = getDiagram(diagramId);
  if (!diagram) {
    throw diagramNotFoundError(diagramId);
  }
  return diagram;
}

/** Look up an element by ID, throwing an MCP error if not found. */
export function requireElement(elementRegistry: ElementRegistry, elementId: string): BpmnElement {
  const element = elementRegistry.get(elementId);
  if (!element) {
    throw elementNotFoundError(elementId);
  }
  return element;
}

/**
 * Wrap a plain object into the MCP tool-result envelope.
 *
 * Also sets `structuredContent` to the same object (MCP's machine-readable
 * duplicate of a JSON result) — purely additive: `content[0].text` still
 * carries the identical JSON as a string, so `JSON.parse(result.content[0].text)`
 * (the pattern ~1500 existing tests use via `parseResult()`) is unaffected.
 */
export function jsonResult(data: Record<string, any>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/** Save XML back to diagram state and auto-persist if enabled. */
export async function syncXml(diagram: ReturnType<typeof requireDiagram>) {
  const { xml } = await diagram.modeler.saveXML({ format: true });
  diagram.xml = xml || '';

  // Auto-persist when file-backed persistence is enabled
  if (isPersistenceEnabled()) {
    // Find the diagram ID in the store
    for (const [id, state] of getAllDiagrams()) {
      if (state === diagram) {
        // Fire-and-forget — persistence failures are non-fatal
        persistDiagram(id, diagram).catch(() => {});
        break;
      }
    }
  }
}

// ── Shared element-filtering helper ────────────────────────────────────────

/**
 * Return all "visible" elements from the registry, filtering out
 * infrastructure types (Process, Collaboration, labels, diagram planes).
 *
 * This replaces the repeated inline filter that appeared in 5+ handler files.
 */
export function getVisibleElements(elementRegistry: ElementRegistry): BpmnElement[] {
  return elementRegistry.filter(
    (el) =>
      !!el.type &&
      el.type !== 'bpmn:Process' &&
      el.type !== 'bpmn:Collaboration' &&
      el.type !== 'label' &&
      !el.type.includes('BPMNDiagram') &&
      !el.type.includes('BPMNPlane')
  );
}

// ── Typed element-by-type helpers ──────────────────────────────────────────
//
// These replace the repeated `elementRegistry.filter((el: any) => el.type === '...')`
// pattern that appeared in 15+ handler files.

/** Return all bpmn:Participant elements. */
export function getParticipants(elementRegistry: ElementRegistry): BpmnElement[] {
  return elementRegistry.filter((el) => el.type === 'bpmn:Participant');
}

/** Return all bpmn:Lane elements. */
export function getLanes(elementRegistry: ElementRegistry): BpmnElement[] {
  return elementRegistry.filter((el) => el.type === 'bpmn:Lane');
}

/** Return all bpmn:Process elements. */
export function getProcesses(elementRegistry: ElementRegistry): BpmnElement[] {
  return elementRegistry.filter((el) => el.type === 'bpmn:Process');
}

/** Return all bpmn:SequenceFlow elements. */
export function getSequenceFlows(elementRegistry: ElementRegistry): BpmnElement[] {
  return elementRegistry.filter((el) => el.type === 'bpmn:SequenceFlow');
}

/** Return all bpmn:MessageFlow elements. */
export function getMessageFlows(elementRegistry: ElementRegistry): BpmnElement[] {
  return elementRegistry.filter((el) => el.type === 'bpmn:MessageFlow');
}

/** Return all elements of a specific BPMN type. */
export function getElementsByType(elementRegistry: ElementRegistry, type: string): BpmnElement[] {
  return elementRegistry.filter((el) => el.type === type);
}

/** Check whether a diagram is a collaboration (has at least one participant). */
export function isCollaboration(elementRegistry: ElementRegistry): boolean {
  return elementRegistry.filter((el) => el.type === 'bpmn:Participant').length > 0;
}

// ── Element type classification ────────────────────────────────────────────

/** Connection types (sequence flows, message flows, associations). */
const CONNECTION_TYPES = new Set([
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
  'bpmn:Association',
]);

/** Container / structural types that are not flow elements. */
const CONTAINER_TYPES = new Set(['bpmn:Participant', 'bpmn:Lane', 'bpmn:Group']);

/**
 * Check if an element is a connection (flow/association).
 * Useful for filtering elements to only flow nodes.
 */
export function isConnectionElement(type: string): boolean {
  return CONNECTION_TYPES.has(type);
}

/**
 * Check if an element is "infrastructure" — a connection, container, or
 * structural element that is not a flow node (task, event, gateway, etc.).
 *
 * This consolidates the repeated filter pattern:
 * `is('bpmn:SequenceFlow') || is('bpmn:MessageFlow') || is('bpmn:Association') ||
 *  is('bpmn:Participant') || is('bpmn:Lane') || is('bpmn:Group')`
 * which appeared in 4+ handler files.
 */
export function isInfrastructureElement(type: string): boolean {
  return CONNECTION_TYPES.has(type) || CONTAINER_TYPES.has(type);
}

// ── Element count summary ──────────────────────────────────────────────────

/**
 * Build a compact element-count summary for a diagram.
 *
 * Returns an object like: { tasks: 4, events: 2, gateways: 1, flows: 5, total: 12 }
 * Useful for tool responses to show how the diagram has grown/changed.
 */
export function buildElementCounts(elementRegistry: any): Record<string, number> {
  const elements = getVisibleElements(elementRegistry);
  let tasks = 0;
  let events = 0;
  let gateways = 0;
  let flows = 0;
  let other = 0;

  for (const el of elements) {
    const t = el.type || '';
    if (t.includes('Task') || t === 'bpmn:CallActivity' || t === 'bpmn:SubProcess') {
      tasks++;
    } else if (t.includes('Event')) {
      events++;
    } else if (t.includes('Gateway')) {
      gateways++;
    } else if (
      t.includes('SequenceFlow') ||
      t.includes('MessageFlow') ||
      t.includes('Association')
    ) {
      flows++;
    } else if (t !== 'bpmn:Participant' && t !== 'bpmn:Lane') {
      other++;
    }
  }

  return { tasks, events, gateways, flows, other, total: elements.length };
}

// ── Connectivity warnings ──────────────────────────────────────────────────

/** Build warnings about disconnected elements for export outputs. */
export function buildConnectivityWarnings(elementRegistry: any): string[] {
  const elements = elementRegistry.filter(
    (el: any) =>
      el.type &&
      (el.type.includes('Event') ||
        el.type.includes('Task') ||
        el.type.includes('Gateway') ||
        el.type.includes('SubProcess') ||
        el.type.includes('CallActivity'))
  );
  const flows = elementRegistry.filter(
    (el: any) => el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow'
  );

  const warnings: string[] = [];
  if (elements.length > 1 && flows.length === 0) {
    warnings.push(
      `⚠️ Note: Diagram has ${elements.length} elements but no flows. Use connect_bpmn_elements to add flows.`
    );
  } else if (elements.length > 1 && flows.length > 0) {
    // Identify actually disconnected elements (no incoming AND no outgoing flows)
    // Exclude start events (only need outgoing), end events (only need incoming),
    // and boundary events (attached to hosts, not connected via standalone flows).
    const disconnected = elements.filter((el: any) => {
      const hasIncoming = el.incoming && el.incoming.length > 0;
      const hasOutgoing = el.outgoing && el.outgoing.length > 0;
      if (el.type === 'bpmn:StartEvent') return !hasOutgoing;
      if (el.type === 'bpmn:EndEvent') return !hasIncoming;
      if (el.type === 'bpmn:BoundaryEvent') return false; // attached to host
      return !hasIncoming && !hasOutgoing;
    });

    if (disconnected.length > 0) {
      const ids = disconnected
        .slice(0, 5)
        .map((el: any) => el.id)
        .join(', ');
      const suffix = disconnected.length > 5 ? ` (and ${disconnected.length - 5} more)` : '';
      warnings.push(
        `💡 Tip: ${disconnected.length} element(s) appear disconnected: ${ids}${suffix}. Use connect_bpmn_elements to add flows.`
      );
    }
  }

  // Warn about orphaned artifacts (TextAnnotation, DataObjectReference, DataStoreReference)
  const artifactTypes = new Set([
    'bpmn:TextAnnotation',
    'bpmn:DataObjectReference',
    'bpmn:DataStoreReference',
  ]);
  const artifacts = elementRegistry.filter((el: any) => artifactTypes.has(el.type));
  if (artifacts.length > 0) {
    const associations = elementRegistry.filter(
      (el: any) =>
        el.type === 'bpmn:Association' ||
        el.type === 'bpmn:DataInputAssociation' ||
        el.type === 'bpmn:DataOutputAssociation'
    );
    const connectedIds = new Set<string>();
    for (const assoc of associations) {
      if (assoc.source) connectedIds.add(assoc.source.id);
      if (assoc.target) connectedIds.add(assoc.target.id);
    }
    const orphaned = artifacts.filter((a: any) => !connectedIds.has(a.id));
    if (orphaned.length > 0) {
      const names = orphaned.map((a: any) => `${a.id} (${a.type.replace('bpmn:', '')})`).join(', ');
      warnings.push(
        `⚠️ Disconnected artifact(s): ${names}. Use connect_bpmn_elements to link them (auto-detects Association or DataAssociation).`
      );
    }
  }

  return warnings;
}

/**
 * Build structured nextSteps for connecting disconnected elements.
 * Returns an array of `{ tool, description, args }` entries that an AI agent
 * can execute directly without further parsing.
 */
export function buildConnectivityNextSteps(
  elementRegistry: any,
  diagramId: string
): Array<{ tool: string; description: string; args: Record<string, unknown> }> {
  const steps: Array<{ tool: string; description: string; args: Record<string, unknown> }> = [];

  const elements = elementRegistry.filter(
    (el: any) =>
      el.type &&
      (el.type.includes('Event') ||
        el.type.includes('Task') ||
        el.type.includes('Gateway') ||
        el.type.includes('SubProcess') ||
        el.type.includes('CallActivity'))
  );
  const flows = elementRegistry.filter(
    (el: any) => el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:MessageFlow'
  );

  if (elements.length <= 1) return steps;

  if (flows.length === 0) {
    // No flows at all — suggest connecting adjacent elements in registry order
    for (let i = 0; i < Math.min(elements.length - 1, 5); i++) {
      steps.push({
        tool: 'connect_bpmn_elements',
        description: `Connect ${elements[i].id} → ${elements[i + 1].id}`,
        args: { diagramId, sourceElementId: elements[i].id, targetElementId: elements[i + 1].id },
      });
    }
    return steps;
  }

  // Find disconnected elements and suggest connecting them to their nearest neighbour
  const disconnected = elements.filter((el: any) => {
    const hasIncoming = el.incoming && el.incoming.length > 0;
    const hasOutgoing = el.outgoing && el.outgoing.length > 0;
    if (el.type === 'bpmn:StartEvent') return !hasOutgoing;
    if (el.type === 'bpmn:EndEvent') return !hasIncoming;
    if (el.type === 'bpmn:BoundaryEvent') return false;
    return !hasIncoming && !hasOutgoing;
  });

  for (const el of disconnected.slice(0, 5)) {
    // Find the connected element nearest to this one (by centre-to-centre distance)
    const connected = elements.filter((e: any) => {
      const hi = e.incoming && e.incoming.length > 0;
      const ho = e.outgoing && e.outgoing.length > 0;
      if (e.type === 'bpmn:StartEvent') return ho;
      if (e.type === 'bpmn:EndEvent') return hi;
      if (e.type === 'bpmn:BoundaryEvent') return false;
      return hi || ho;
    });

    let bestNeighbour: any = null;
    let bestDist = Infinity;
    const elX = (el.x ?? 0) + (el.width ?? 0) / 2;
    const elY = (el.y ?? 0) + (el.height ?? 0) / 2;

    for (const c of connected) {
      const cx = (c.x ?? 0) + (c.width ?? 0) / 2;
      const cy = (c.y ?? 0) + (c.height ?? 0) / 2;
      const dist = Math.hypot(elX - cx, elY - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestNeighbour = c;
      }
    }

    if (bestNeighbour) {
      // Connect neighbour → disconnected element (assume it needs incoming)
      if (el.type === 'bpmn:EndEvent' || !el.incoming || el.incoming.length === 0) {
        steps.push({
          tool: 'connect_bpmn_elements',
          description: `Connect ${bestNeighbour.id} → ${el.id} (${el.type.replace('bpmn:', '')})`,
          args: { diagramId, sourceElementId: bestNeighbour.id, targetElementId: el.id },
        });
      } else {
        steps.push({
          tool: 'connect_bpmn_elements',
          description: `Connect ${el.id} → ${bestNeighbour.id} (${bestNeighbour.type.replace('bpmn:', '')})`,
          args: { diagramId, sourceElementId: el.id, targetElementId: bestNeighbour.id },
        });
      }
    }
  }

  return steps;
}
