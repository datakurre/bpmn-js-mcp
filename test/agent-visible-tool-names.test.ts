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
import fs from 'node:fs';
import path from 'node:path';
import { describe, test, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../src/tool-definitions';
import { ALL_DISPATCHABLE_TOOL_NAMES } from '../src/handlers/index';
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
  // Includes hidden aliases (tools consolidated into another tool but kept
  // dispatchable for one release, see ADR-021) — a "former X tool" mention
  // of one of those is accurate, not stale.
  const validToolNames = new Set(ALL_DISPATCHABLE_TOOL_NAMES);
  const sources = collectAgentVisibleText();

  for (const [source, blob] of Object.entries(sources)) {
    test(`${source} has no stale tool-name references`, () => {
      const found = new Set(blob.match(TOOL_NAME_TOKEN) ?? []);
      const unknown = [...found].filter((name) => !validToolNames.has(name));
      expect(unknown).toEqual([]);
    });
  }
});

describe('agent-visible lane hints', () => {
  // analyze_bpmn_lanes' public schema has no laneId/elementIds, so a hint
  // routing manual lane assignment through it cannot be followed (#21).
  // Hints are built as strings inside handlers, so scan the sources.
  function listSourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSourceFiles(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });
  }

  test('no hint routes manual lane assignment through analyze_bpmn_lanes', () => {
    const srcDir = path.resolve(__dirname, '../src');
    const offenders = listSourceFiles(srcDir).filter((file) =>
      fs.readFileSync(file, 'utf-8').includes('strategy: manual')
    );
    expect(offenders.map((file) => path.relative(srcDir, file))).toEqual([]);
  });
});
