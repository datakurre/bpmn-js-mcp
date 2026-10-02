/**
 * Tests for the optional core/full tool tiers (#9).
 *
 * `computeToolDefinitions(tier)` is tested directly with an explicit tier
 * argument rather than by mutating `process.env.BPMN_MCP_TOOLS`, since
 * `TOOL_DEFINITIONS`/`TOOL_TIER` are resolved once at module load — well
 * before any test could set the env var.
 */
import { describe, test, expect } from 'vitest';
import {
  computeToolDefinitions,
  TOOL_DEFINITIONS,
  TOOL_TIER,
  dispatchToolCall,
} from '../src/handlers';

const CORE_TOOL_NAMES = [
  'create_bpmn_diagram',
  'export_bpmn',
  'add_bpmn_elements',
  'connect_bpmn_elements',
  'delete_bpmn_element',
  'move_bpmn_element',
  'set_bpmn_element_properties',
  'layout_bpmn_diagram',
  'validate_bpmn_diagram',
  'batch_bpmn_operations',
];

describe('tool tiers (#9)', () => {
  test('default tier (no BPMN_MCP_TOOLS set) is full', () => {
    expect(TOOL_TIER).toBe('full');
    expect(TOOL_DEFINITIONS.length).toBe(20);
  });

  test('core tier exposes exactly the documented 10 tools', () => {
    const core = computeToolDefinitions('core');
    expect(core.map((t) => t.name).sort()).toEqual([...CORE_TOOL_NAMES].sort());
  });

  test('full tier is a superset of core tier', () => {
    const core = new Set(computeToolDefinitions('core').map((t) => t.name));
    const full = new Set(computeToolDefinitions('full').map((t) => t.name));
    for (const name of core) {
      expect(full.has(name)).toBe(true);
    }
    expect(full.size).toBeGreaterThan(core.size);
  });

  test('core tier omits collaboration/lane/history/Camunda-listener tools', () => {
    const coreNames = new Set(computeToolDefinitions('core').map((t) => t.name));
    for (const name of [
      'create_bpmn_participant',
      'create_bpmn_lanes',
      'analyze_bpmn_lanes',
      'manage_bpmn_root_elements',
      'bpmn_history',
      'list_bpmn_process_variables',
    ]) {
      expect(coreNames.has(name)).toBe(false);
    }
  });

  test('a tool omitted from the core tier is still dispatchable regardless of tier', async () => {
    // Tiering only filters ListTools; dispatch always accepts every registered tool.
    try {
      await dispatchToolCall('create_bpmn_participant', {});
    } catch (err: any) {
      expect(err.message).not.toContain('Unknown tool');
    }
  });

  test('core tier definitions carry the same annotations as full tier', () => {
    const coreDef = computeToolDefinitions('core').find((t) => t.name === 'export_bpmn');
    const fullDef = computeToolDefinitions('full').find((t) => t.name === 'export_bpmn');
    expect((coreDef as any).annotations).toEqual((fullDef as any).annotations);
  });
});
