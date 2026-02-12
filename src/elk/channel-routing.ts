/**
 * Post-routing channel routing for gateway branches.
 *
 * Re-routes vertical segments of gateway branch connections through the
 * midpoint of the inter-column gap (the "channel"), replicating
 * bpmn-auto-layout's channel-routing aesthetic.
 */

import { detectLayers } from './grid-snap';
import { CHANNEL_GW_PROXIMITY, MIN_CHANNEL_WIDTH, CHANNEL_MARGIN_FACTOR } from './constants';
import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';

/**
 * Re-route vertical segments of gateway branch connections through the
 * midpoint of the inter-column gap (the "channel").
 *
 * After ELK edge routing + grid snap, connections exiting a gateway to a
 * branch element on a different row may place their vertical segment very
 * close to the gateway edge.  This pass finds such connections and shifts
 * the vertical segment's X to the midpoint between the source and target
 * columns.
 *
 * When multiple connections from the same gateway need channel routing,
 * their vertical segments are spread evenly across the channel width to
 * prevent overlaps and crossing flows.
 *
 * Only applies to connections where the source is a gateway going to a
 * different layer, with at most 2 off-row branches.
 */
export function routeBranchConnectionsThroughChannels(
  elementRegistry: ElementRegistry,
  modeling: Modeling,
  container?: BpmnElement
): void {
  const layers = detectLayers(elementRegistry, container);
  if (layers.length < 2) return;

  // Build a map from element ID → layer index for fast lookup
  const elementToLayer = new Map<string, number>();
  for (let i = 0; i < layers.length; i++) {
    for (const el of layers[i].elements) {
      elementToLayer.set(el.id, i);
    }
  }

  const allConnections = elementRegistry.filter(
    (el) =>
      el.type === 'bpmn:SequenceFlow' &&
      !!el.source &&
      !!el.target &&
      !!el.waypoints &&
      el.waypoints.length >= 3
  );

  // Build a count of outgoing sequence flows per gateway (to identify splits)
  const gwOutgoingCount = new Map<string, number>();
  for (const conn of allConnections) {
    if (conn.source?.type?.includes('Gateway')) {
      gwOutgoingCount.set(conn.source.id, (gwOutgoingCount.get(conn.source.id) || 0) + 1);
    }
  }

  // Count how many outgoing connections from each split gateway go to
  // a different row. We only apply channel routing for gateways with
  // exactly 2 off-row branches (the common exclusive gateway pattern).
  // For larger fan-outs, ELK already handles routing well.
  const gwOffRowCount = new Map<string, number>();
  for (const conn of allConnections) {
    const src = conn.source!;
    if (!src.type?.includes('Gateway')) continue;
    if ((gwOutgoingCount.get(src.id) || 0) < 2) continue;

    const srcLayer = elementToLayer.get(src.id);
    const tgtLayer = elementToLayer.get(conn.target!.id);
    if (srcLayer === undefined || tgtLayer === undefined) continue;
    if (srcLayer === tgtLayer) continue;

    gwOffRowCount.set(src.id, (gwOffRowCount.get(src.id) || 0) + 1);
  }

  // Group connections by source gateway for coordinated channel allocation.
  // Only include connections from split gateways (≥2 outgoing flows) to
  // avoid routing join→next connections through the channel, which can
  // interfere with incoming branch connections.
  const gwGroups = new Map<
    string,
    Array<{
      conn: BpmnElement;
      channelAfterLayer: number;
      vertSegIndex: number;
    }>
  >();

  for (const conn of allConnections) {
    const src = conn.source!;
    const tgt = conn.target!;

    // Only process connections where source is a gateway going to a different row
    const srcIsGw = src.type?.includes('Gateway');
    if (!srcIsGw) continue;

    // Only process split gateways (≥2 outgoing flows), not join→next flows
    if ((gwOutgoingCount.get(src.id) || 0) < 2) continue;

    // Skip gateways with more than 2 off-row branches — ELK handles
    // multi-branch fan-outs well; channel routing can cause crossings.
    if ((gwOffRowCount.get(src.id) || 0) > 2) continue;

    const srcLayer = elementToLayer.get(src.id);
    const tgtLayer = elementToLayer.get(tgt.id);
    if (srcLayer === undefined || tgtLayer === undefined) continue;
    if (srcLayer === tgtLayer) continue;

    const minLayer = Math.min(srcLayer, tgtLayer);
    const maxLayer = Math.max(srcLayer, tgtLayer);
    const channelAfterLayer = srcLayer < tgtLayer ? minLayer : maxLayer - 1;
    if (channelAfterLayer < 0 || channelAfterLayer >= layers.length - 1) continue;

    // Find the first vertical segment near the gateway
    const wps: Array<{ x: number; y: number }> = conn.waypoints!;
    const gwCx = src.x + (src.width || 0) / 2;
    let vertSegIdx = -1;
    for (let i = 0; i < wps.length - 1; i++) {
      const curr = wps[i];
      const next = wps[i + 1];
      const dx = Math.abs(curr.x - next.x);
      const dy = Math.abs(curr.y - next.y);
      if (dx < 2 && dy > 5 && Math.abs(curr.x - gwCx) < CHANNEL_GW_PROXIMITY) {
        vertSegIdx = i;
        break;
      }
    }

    if (vertSegIdx < 0) continue;

    const key = `${src.id}:${channelAfterLayer}`;
    const group = gwGroups.get(key) || [];
    group.push({ conn, channelAfterLayer, vertSegIndex: vertSegIdx });
    gwGroups.set(key, group);
  }

  // Process each gateway group: spread vertical segments across the channel.
  // Only apply to gateways with at most 2 branch connections needing routing.
  // For larger fan-outs (3+ branches), ELK already spaces port positions well
  // and moving vertical segments can cause crossings with join-side connections.
  for (const [, group] of gwGroups) {
    if (group.length > 2) continue; // Skip large fan-outs

    const { channelAfterLayer } = group[0];
    const leftColRight = layers[channelAfterLayer].maxRight;
    const rightColLeft = layers[channelAfterLayer + 1].minX;
    const channelMid = (leftColRight + rightColLeft) / 2;
    const channelWidth = rightColLeft - leftColRight;

    // Skip if channel is too narrow for meaningful routing
    if (channelWidth < MIN_CHANNEL_WIDTH) continue;

    // For a single connection, use the channel midpoint.
    // For multiple connections, spread them evenly but keep them within
    // the middle 60% of the channel to maintain clearance from columns.
    const margin = channelWidth * CHANNEL_MARGIN_FACTOR;
    const usableLeft = leftColRight + margin;
    const usableRight = rightColLeft - margin;
    const usableWidth = usableRight - usableLeft;

    // Sort group by target Y so vertical segments don't cross each other
    group.sort((a, b) => {
      const aY = a.conn.target!.y + (a.conn.target!.height || 0) / 2;
      const bY = b.conn.target!.y + (b.conn.target!.height || 0) / 2;
      return aY - bY;
    });

    for (let gi = 0; gi < group.length; gi++) {
      const { conn, vertSegIndex } = group[gi];
      let channelX: number;
      if (group.length === 1) {
        channelX = channelMid;
      } else {
        // Spread evenly across usable channel width
        channelX = usableLeft + (usableWidth * gi) / (group.length - 1);
      }
      channelX = Math.round(channelX);

      const wps: Array<{ x: number; y: number }> = conn.waypoints!;
      const currX = wps[vertSegIndex].x;
      if (Math.abs(currX - channelX) <= 5) continue;

      // Verify the move doesn't place the vertical segment outside the
      // channel (between the source right edge and target left edge)
      const srcRight = conn.source!.x + (conn.source!.width || 0);
      const tgtLeft = conn.target!.x;
      if (channelX <= srcRight || channelX >= tgtLeft) continue;

      const newWps = wps.map((wp: { x: number; y: number }) => ({ x: wp.x, y: wp.y }));
      newWps[vertSegIndex].x = channelX;
      newWps[vertSegIndex + 1].x = channelX;
      modeling.updateWaypoints(conn, newWps);
    }
  }
}
