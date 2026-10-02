/**
 * `bpmnModule.dispatch` is the server's routing entry point: it must accept
 * every registered tool, including hidden aliases and tools outside the
 * active tier, not only the tools advertised in ListTools.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import type { ToolModule } from '../src/module';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Import a fresh bpmnModule, optionally under a BPMN_MCP_TOOLS tier. */
async function loadModule(tier?: string): Promise<ToolModule> {
  vi.resetModules();
  if (tier) vi.stubEnv('BPMN_MCP_TOOLS', tier);
  const { bpmnModule } = await import('../src/bpmn-module');
  return bpmnModule;
}

async function call(mod: ToolModule, name: string, args: Record<string, unknown>) {
  const pending = mod.dispatch(name, args);
  expect(pending, `${name} should be routed`).toBeDefined();
  return pending!;
}

async function createDiagram(mod: ToolModule): Promise<string> {
  const result = await call(mod, 'create_bpmn_diagram', { name: 'Dispatch', includeImage: [] });
  return JSON.parse(result.content[0].text as string).diagramId;
}

describe('bpmnModule.dispatch', () => {
  test('routes hidden aliases of consolidated tools', async () => {
    const mod = await loadModule();
    expect(mod.toolDefinitions.map((t) => t.name)).not.toContain('set_bpmn_input_output_mapping');

    const diagramId = await createDiagram(mod);
    const added = await call(mod, 'add_bpmn_elements', {
      diagramId,
      elements: [{ elementType: 'bpmn:UserTask', name: 'Review' }],
    });
    const { elementId } = JSON.parse(added.content[0].text as string).elements[0];

    const result = await call(mod, 'set_bpmn_input_output_mapping', {
      diagramId,
      elementId,
      inputParameters: [{ name: 'x', value: '1' }],
    });
    expect(result.isError).toBeFalsy();
  });

  test('routes non-core tools when BPMN_MCP_TOOLS=core', async () => {
    const mod = await loadModule('core');
    const listed = mod.toolDefinitions.map((t) => t.name);
    expect(listed).toHaveLength(10);
    expect(listed).not.toContain('list_bpmn_process_variables');

    const diagramId = await createDiagram(mod);
    const result = await call(mod, 'list_bpmn_process_variables', { diagramId });
    expect(result.isError).toBeFalsy();
  });

  test('ignores tools it does not own', async () => {
    const mod = await loadModule();
    expect(mod.dispatch('not_a_bpmn_tool', {})).toBeUndefined();
  });
});
