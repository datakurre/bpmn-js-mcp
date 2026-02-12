/**
 * Happy path detection for BPMN diagrams.
 *
 * Detects the main flow from a start event to an end event, following
 * the conditioned (non-default) flows at exclusive/inclusive gateways.
 * In BPMN semantics, the `default` flow is the fallback taken when no
 * condition matches — typically the error/exception path.  The happy
 * path should follow the designed/conditioned branches instead.
 *
 * At parallel gateways (and when no default is set), follows the first
 * outgoing flow.
 */

import { isConnection, isInfrastructure } from './helpers';
import type { BpmnElement } from '../bpmn-types';

/**
 * Detect the "happy path" — the main flow from a start event to an end
 * event, following conditioned (non-default) flows at exclusive/inclusive
 * gateways, or the first outgoing flow when no default is set.
 *
 * Returns a Set of connection (edge) IDs that form the happy path.
 */
export function detectHappyPath(allElements: BpmnElement[]): Set<string> {
  const happyEdgeIds = new Set<string>();

  // Find start events (entry points)
  const startEvents = allElements.filter(
    (el) => el.type === 'bpmn:StartEvent' && !isInfrastructure(el.type)
  );
  if (startEvents.length === 0) return happyEdgeIds;

  // Build adjacency: node → outgoing connections
  const outgoing = new Map<string, BpmnElement[]>();
  for (const el of allElements) {
    if (isConnection(el.type) && el.source && el.target) {
      const list = outgoing.get(el.source.id) || [];
      list.push(el);
      outgoing.set(el.source.id, list);
    }
  }

  // Build a map of gateway default flows (gateway businessObject.default)
  const gatewayDefaults = new Map<string, string>();
  for (const el of allElements) {
    if (el.type?.includes('Gateway') && el.businessObject?.default) {
      gatewayDefaults.set(el.id, el.businessObject.default.id);
    }
  }

  // Walk from each start event, following the preferred flow at each node
  const visited = new Set<string>();
  for (const start of startEvents) {
    let current = start;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);

      const connections = outgoing.get(current.id);
      if (!connections || connections.length === 0) break;

      // Pick the preferred outgoing connection:
      //
      // At exclusive/inclusive gateways with a default flow:
      //   → Follow the FIRST NON-DEFAULT outgoing flow (the conditioned
      //     branch).  The default flow is the fallback/exception path
      //     in BPMN semantics — the happy path should follow the
      //     designed condition branches.
      //
      // At parallel gateways or nodes without a default:
      //   → Follow the first outgoing flow (preserves model order).
      let chosen: BpmnElement | undefined;
      const defaultFlowId = gatewayDefaults.get(current.id);
      if (defaultFlowId && connections.length > 1) {
        // Prefer the first non-default flow (the conditioned branch)
        chosen = connections.find((c) => c.id !== defaultFlowId);
      }
      if (!chosen) {
        chosen = connections[0];
      }

      happyEdgeIds.add(chosen!.id);
      current = chosen!.target!;
    }
  }

  return happyEdgeIds;
}
