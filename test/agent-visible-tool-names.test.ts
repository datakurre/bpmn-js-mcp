/**
 * Regression test for issue: agent-visible text (tool definitions, lint fix
 * suggestions, prompts, and resource guides) must never reference a tool
 * name that isn't actually registered. An agent that follows stale advice
 * (e.g. a tool merged away by a consolidation) gets "Unknown tool" and
 * wastes turns.
 *
 * Scans every string in the gathered text for snake_case tokens that look
 * like a tool name (contain "bpmn" joined by underscores, e.g.
 * `create_bpmn_diagram`) and fails if the token isn't a currently
 * registered tool name.
 */
import { describe, test, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../src/tool-definitions';
import { FIX_SUGGESTIONS } from '../src/lint-suggestions';
import {
  EXECUTABLE_CAMUNDA7_GUIDE,
  MODELING_ELEMENTS_GUIDE,
  ELEMENT_PROPERTIES_GUIDE,
} from '../src/resource-guides';
import { listPrompts, getPrompt } from '../src/prompts';

/** Matches snake_case tool-name-shaped tokens, e.g. create_bpmn_diagram, bpmn_history. */
const TOOL_NAME_TOKEN = /\b(?:[a-z][a-z0-9]*_)*bpmn(?:_[a-z0-9]+)+\b/g;

function collectAgentVisibleText(): Record<string, string> {
  const text: Record<string, string> = {
    toolDefinitions: JSON.stringify(TOOL_DEFINITIONS),
    fixSuggestions: JSON.stringify(FIX_SUGGESTIONS),
    executableCamunda7Guide: EXECUTABLE_CAMUNDA7_GUIDE,
    modelingElementsGuide: MODELING_ELEMENTS_GUIDE,
    elementPropertiesGuide: ELEMENT_PROPERTIES_GUIDE,
  };

  for (const { name } of listPrompts()) {
    const { messages } = getPrompt(name);
    text[`prompt:${name}`] = messages.map((m) => m.content.text).join('\n');
  }

  return text;
}

describe('agent-visible text only references registered tools', () => {
  const validToolNames = new Set(TOOL_DEFINITIONS.map((t) => t.name));
  const sources = collectAgentVisibleText();

  for (const [source, blob] of Object.entries(sources)) {
    test(`${source} has no stale tool-name references`, () => {
      const found = new Set(blob.match(TOOL_NAME_TOKEN) ?? []);
      const unknown = [...found].filter((name) => !validToolNames.has(name));
      expect(unknown).toEqual([]);
    });
  }
});
