/**
 * MCP Resources — stable, addressable read-context endpoints.
 *
 * Exposes diagram data as MCP resources so AI callers can re-ground
 * context mid-conversation without tool calls:
 *
 *   bpmn://diagrams             — list all in-memory diagrams
 *   bpmn://diagram/{id}/summary — lightweight diagram summary
 *   bpmn://diagram/{id}/lint    — validation issues + fix suggestions
 *   bpmn://diagram/{id}/variables — process variable references
 *   bpmn://diagram/{id}/xml    — current BPMN XML
 *   bpmn://diagram/{id}/svg    — current diagram SVG
 *   bpmn://diagram/{id}/elements — all elements with properties
 *   bpmn://guides/executable-camunda7 — Camunda 7 deployment guide
 *   bpmn://guides/modeling-elements — element modeling best practices
 *   bpmn://guides/element-properties — Camunda property catalog
 *   ui://bpmn-diagram-viewer   — interactive MCP Apps diagram viewer (issue #11)
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getAllDiagrams, getDiagram } from './diagram-manager';
import { handleSummarizeDiagram } from './handlers/core/summarize-diagram';
import { handleValidate } from './handlers/core/validate';
import { handleListProcessVariables } from './handlers/core/list-process-variables';
import { handleListDiagrams } from './handlers/core/list-diagrams';
import { handleListElements } from './handlers/elements/list-elements';
import {
  EXECUTABLE_CAMUNDA7_GUIDE,
  MODELING_ELEMENTS_GUIDE,
  ELEMENT_PROPERTIES_GUIDE,
} from './resource-guides';
import { adjustSvgViewBox } from './handlers/core/export-helpers';
import {
  APP_VIEWER_RESOURCE_URI,
  APP_VIEWER_MIME_TYPE,
  renderAppViewerHtml,
} from './mcp-apps/resource';

const MIME_MARKDOWN = 'text/markdown';

/** Resource template definitions for bpmn:// URIs. */
export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'bpmn://diagram/{diagramId}/summary',
    name: 'Diagram summary',
    description:
      'Lightweight summary of a BPMN diagram: process name, element counts by type, ' +
      'participant/lane names, named elements, and connectivity stats.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'bpmn://diagram/{diagramId}/lint',
    name: 'Diagram validation',
    description:
      'bpmnlint validation issues with severities, fix suggestions, and structured tool call hints.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'bpmn://diagram/{diagramId}/variables',
    name: 'Process variables',
    description:
      'All process variables referenced in the diagram with read/write access patterns and source elements.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'bpmn://diagram/{diagramId}/xml',
    name: 'Diagram XML',
    description:
      'Current BPMN 2.0 XML of the diagram. Useful for re-grounding context during iterative editing sessions.',
    mimeType: 'application/xml',
  },
  {
    uriTemplate: 'bpmn://diagram/{diagramId}/svg',
    name: 'Diagram SVG',
    description:
      'Current SVG rendering of the diagram, viewBox-tightened to content bounds (same as export_bpmn format: "svg").',
    mimeType: 'image/svg+xml',
  },
  {
    uriTemplate: 'bpmn://diagram/{diagramId}/elements',
    name: 'Diagram elements',
    description:
      'All elements in the diagram with types, names, positions, connections, and Camunda properties. ' +
      'Equivalent to calling list_bpmn_elements without filters.',
    mimeType: 'application/json',
  },
];

/**
 * Static guide resources — always listed regardless of diagram state.
 * These provide stable reference material for AI callers.
 */
export const STATIC_RESOURCES = [
  {
    uri: 'bpmn://guides/executable-camunda7',
    name: 'Executable Camunda 7 / Operaton guide',
    description:
      'Constraints, conventions, and best practices for building executable BPMN processes ' +
      'targeting Camunda 7 (Operaton). Covers deployment, task types, forms, and common pitfalls.',
    mimeType: MIME_MARKDOWN,
  },
  {
    uri: 'bpmn://guides/modeling-elements',
    name: 'BPMN element modeling guide',
    description:
      'Best practices for choosing element types, naming conventions, boundary events, ' +
      'subprocesses, event subprocesses, and service integration patterns.',
    mimeType: MIME_MARKDOWN,
  },
  {
    uri: 'bpmn://guides/element-properties',
    name: 'Camunda element properties reference',
    description:
      'Complete catalog of supported standard BPMN and Camunda extension properties ' +
      'organized by element type, with examples.',
    mimeType: MIME_MARKDOWN,
  },
  {
    uri: APP_VIEWER_RESOURCE_URI,
    name: 'Interactive diagram viewer (MCP Apps)',
    description:
      'Self-contained interactive bpmn-js view. Referenced via `_meta.ui.resourceUri` ' +
      'on mutating tools (issue #11 / ADR-025) — MCP Apps-capable hosts render it inline ' +
      "instead of (or alongside) each tool's plain text/image response.",
    mimeType: APP_VIEWER_MIME_TYPE,
  },
];

/**
 * List all currently available concrete resources.
 * Returns a `bpmn://diagrams` entry plus per-diagram resources.
 */
export function listResources(): any[] {
  const diagrams = getAllDiagrams();
  const resources: any[] = [];

  // Static resource: diagram list
  resources.push({
    uri: 'bpmn://diagrams',
    name: 'All diagrams',
    description: `List of all ${diagrams.size} in-memory BPMN diagrams`,
    mimeType: 'application/json',
  });

  // Static guide resources (always available)
  resources.push(...STATIC_RESOURCES);

  // Per-diagram resources
  for (const [id, state] of diagrams) {
    const name = state.name || '(unnamed)';
    resources.push({
      uri: `bpmn://diagram/${id}/summary`,
      name: `${name} — summary`,
      description: `Lightweight summary of diagram "${name}"`,
      mimeType: 'application/json',
    });
    resources.push({
      uri: `bpmn://diagram/${id}/lint`,
      name: `${name} — validation`,
      description: `Validation issues for diagram "${name}"`,
      mimeType: 'application/json',
    });
    resources.push({
      uri: `bpmn://diagram/${id}/variables`,
      name: `${name} — variables`,
      description: `Process variables in diagram "${name}"`,
      mimeType: 'application/json',
    });
    resources.push({
      uri: `bpmn://diagram/${id}/xml`,
      name: `${name} — XML`,
      description: `BPMN 2.0 XML of diagram "${name}"`,
      mimeType: 'application/xml',
    });
    resources.push({
      uri: `bpmn://diagram/${id}/svg`,
      name: `${name} — SVG`,
      description: `SVG rendering of diagram "${name}"`,
      mimeType: 'image/svg+xml',
    });
    resources.push({
      uri: `bpmn://diagram/${id}/elements`,
      name: `${name} — elements`,
      description: `All elements in diagram "${name}"`,
      mimeType: 'application/json',
    });
  }

  return resources;
}

/** Extract the text content from a handler ToolResult. */
function extractText(result: any): string {
  if (result?.content?.[0]?.text) return result.content[0].text;
  return JSON.stringify(result);
}

/**
 * Read a specific resource by URI.
 * Returns `{ contents: [{ uri, mimeType, text }] }`.
 */
export async function readResource(
  uri: string
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  // bpmn://diagrams
  if (uri === 'bpmn://diagrams') {
    const result = await handleListDiagrams();
    return {
      contents: [{ uri, mimeType: 'application/json', text: extractText(result) }],
    };
  }

  // bpmn://diagram/{id}/summary
  const summaryMatch = uri.match(/^bpmn:\/\/diagram\/([^/]+)\/summary$/);
  if (summaryMatch) {
    const diagramId = summaryMatch[1];
    ensureDiagramExists(diagramId);
    const result = await handleSummarizeDiagram({ diagramId });
    return {
      contents: [{ uri, mimeType: 'application/json', text: extractText(result) }],
    };
  }

  // bpmn://diagram/{id}/lint
  const lintMatch = uri.match(/^bpmn:\/\/diagram\/([^/]+)\/lint$/);
  if (lintMatch) {
    const diagramId = lintMatch[1];
    ensureDiagramExists(diagramId);
    const result = await handleValidate({ diagramId });
    return {
      contents: [{ uri, mimeType: 'application/json', text: extractText(result) }],
    };
  }

  // bpmn://diagram/{id}/variables
  const varsMatch = uri.match(/^bpmn:\/\/diagram\/([^/]+)\/variables$/);
  if (varsMatch) {
    const diagramId = varsMatch[1];
    ensureDiagramExists(diagramId);
    const result = await handleListProcessVariables({ diagramId });
    return {
      contents: [{ uri, mimeType: 'application/json', text: extractText(result) }],
    };
  }

  // bpmn://diagram/{id}/xml
  const xmlMatch = uri.match(/^bpmn:\/\/diagram\/([^/]+)\/xml$/);
  if (xmlMatch) {
    const diagramId = xmlMatch[1];
    ensureDiagramExists(diagramId);
    const diagram = getDiagram(diagramId)!;
    return {
      contents: [{ uri, mimeType: 'application/xml', text: diagram.xml }],
    };
  }

  // bpmn://diagram/{id}/svg
  const svgResult = await tryReadSvgResource(uri);
  if (svgResult) return svgResult;

  // bpmn://diagram/{id}/elements
  const elementsMatch = uri.match(/^bpmn:\/\/diagram\/([^/]+)\/elements$/);
  if (elementsMatch) {
    const diagramId = elementsMatch[1];
    ensureDiagramExists(diagramId);
    const result = await handleListElements({ diagramId });
    return {
      contents: [{ uri, mimeType: 'application/json', text: extractText(result) }],
    };
  }

  // bpmn://guides/executable-camunda7
  if (uri === 'bpmn://guides/executable-camunda7') {
    return {
      contents: [{ uri, mimeType: MIME_MARKDOWN, text: EXECUTABLE_CAMUNDA7_GUIDE }],
    };
  }

  // bpmn://guides/modeling-elements
  if (uri === 'bpmn://guides/modeling-elements') {
    return {
      contents: [{ uri, mimeType: MIME_MARKDOWN, text: MODELING_ELEMENTS_GUIDE }],
    };
  }

  // bpmn://guides/element-properties
  if (uri === 'bpmn://guides/element-properties') {
    return {
      contents: [{ uri, mimeType: MIME_MARKDOWN, text: ELEMENT_PROPERTIES_GUIDE }],
    };
  }

  // ui://bpmn-diagram-viewer (MCP Apps — issue #11 / ADR-025)
  if (uri === APP_VIEWER_RESOURCE_URI) {
    return {
      contents: [{ uri, mimeType: APP_VIEWER_MIME_TYPE, text: renderAppViewerHtml() }],
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
}

/** Validate that a diagram ID exists, throwing McpError if not. */
function ensureDiagramExists(diagramId: string): void {
  if (!getDiagram(diagramId)) {
    throw new McpError(ErrorCode.InvalidRequest, `Diagram not found: ${diagramId}`);
  }
}

/** Handle `bpmn://diagram/{id}/svg`, or return undefined if the URI doesn't match. */
async function tryReadSvgResource(
  uri: string
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> } | undefined> {
  const match = uri.match(/^bpmn:\/\/diagram\/([^/]+)\/svg$/);
  if (!match) return undefined;

  const diagramId = match[1];
  ensureDiagramExists(diagramId);
  const diagram = getDiagram(diagramId)!;
  const { svg } = await diagram.modeler.saveSVG();
  const tightSvg = adjustSvgViewBox(svg || '', diagram);
  return {
    contents: [{ uri, mimeType: 'image/svg+xml', text: tightSvg }],
  };
}
