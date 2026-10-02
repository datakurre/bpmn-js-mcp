import { describe, test, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../../../src/tool-definitions';
import { dispatchToolCall, ALL_DISPATCHABLE_TOOL_NAMES } from '../../../src/handlers';

describe('batch_bpmn_operations — all tools dispatchable', () => {
  test('every registered tool name can be dispatched (no "Unknown tool")', () => {
    // Verify that every tool in TOOL_DEFINITIONS has a matching handler
    // in the dispatch map. We don't execute them (they need valid args),
    // but we verify they don't throw MethodNotFound.
    for (const tool of TOOL_DEFINITIONS) {
      // Calling with invalid args should throw a validation error,
      // NOT "Unknown tool". This confirms the dispatch map covers all tools.
      const promise = dispatchToolCall(tool.name, {});
      // We expect either a validation error or a result — NOT "Unknown tool"
      promise.catch((err: any) => {
        expect(err.message).not.toContain('Unknown tool');
      });
    }
  });

  test('every hidden alias can also be dispatched (no "Unknown tool")', () => {
    // Hidden aliases (see ADR-021) are excluded from TOOL_DEFINITIONS but
    // still dispatchable for one release.
    const hiddenNames = ALL_DISPATCHABLE_TOOL_NAMES.filter(
      (name) => !TOOL_DEFINITIONS.some((t) => t.name === name)
    );
    expect(hiddenNames.length).toBeGreaterThan(0);
    for (const name of hiddenNames) {
      const promise = dispatchToolCall(name, {});
      promise.catch((err: any) => {
        expect(err.message).not.toContain('Unknown tool');
      });
    }
  });

  test('TOOL_DEFINITIONS and dispatch map have the expected tool counts', () => {
    // 27 dispatchable tools total — 12 removed entirely via tool consolidation:
    //   clone_bpmn_diagram → create_bpmn_diagram (cloneFrom),
    //   wrap_bpmn_process_in_collaboration → create_bpmn_participant (wrapExisting),
    //   convert_bpmn_collaboration_to_lanes → create_bpmn_lanes (mergeFrom),
    //   diff_bpmn_diagrams → list_bpmn_diagrams (compareWith),
    //   autosize_bpmn_pools_and_lanes → layout_bpmn_diagram (autosizeOnly),
    //   redistribute_bpmn_elements_across_lanes → create_bpmn_lanes (strategy),
    //   replace_bpmn_element → set_bpmn_element_properties (elementType),
    //   set_bpmn_connection_waypoints → connect_bpmn_elements (connectionId + waypoints),
    //   handoff_bpmn_to_lane → add_bpmn_elements (fromElementId + toLaneId),
    //   get_bpmn_element_properties → list_bpmn_elements (elementIds; ADR-027, #23 —
    //     removed outright, not kept as a hidden alias, per #23's no-alias policy),
    //   set_bpmn_event_definition → set_bpmn_element_properties (eventDefinition; ADR-028, #23 —
    //     same no-alias policy),
    //   import_bpmn_xml → create_bpmn_diagram (xml/filePath/autoLayout; ADR-030, #23 —
    //     same no-alias policy).
    // Of those 25, 5 are hidden aliases (ADR-021, #8): consolidated into
    // set_bpmn_element_properties's inputOutput/formData/listeners/
    // callActivityVariables/loop sub-objects, so only 20 are publicly listed.
    expect(ALL_DISPATCHABLE_TOOL_NAMES.length).toBe(25);
    expect(TOOL_DEFINITIONS.length).toBe(20);

    // Verify no tool name is duplicated
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  test('unknown tool name throws MethodNotFound', async () => {
    await expect(dispatchToolCall('nonexistent_tool', {})).rejects.toThrow(/Unknown tool/);
  });
});
