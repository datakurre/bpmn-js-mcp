/**
 * Handler for import_bpmn_xml tool.
 *
 * Supports an optional `autoLayout` boolean:
 *  - `true`:  always run auto-layout after import
 *  - `false`: never run auto-layout (use embedded DI as-is)
 *  - omitted: auto-detect — run layout only if the XML lacks DI coordinates
 *
 * When layout is needed, bpmn-auto-layout generates initial DI (diagram
 * interchange) coordinates, then elkjs (ELK layered algorithm) improves
 * the layout quality.
 */
// @mutating

import { type ToolResult, type HintLevel, type ToolContext } from '../../types';
import { storeDiagram, generateDiagramId, createModelerFromXml } from '../../diagram-manager';
import { jsonResult, syncXml } from '../helpers';
import { appendLintFeedback } from '../../linter';
import { elkLayout } from '../../elk/api';
import * as fs from 'node:fs';

export interface ImportXmlArgs {
  xml?: string;
  filePath?: string;
  autoLayout?: boolean;
  /** When true, suppress implicit lint feedback on every operation.
   *  @deprecated Use `hintLevel` instead.
   */
  draftMode?: boolean;
  /** Controls implicit feedback verbosity. Overrides draftMode when set. */
  hintLevel?: HintLevel;
}

/** Check whether BPMN XML contains diagram interchange (DI) coordinates. */
function xmlHasDiagramDI(xml: string): boolean {
  return xml.includes('bpmndi:BPMNShape') || xml.includes('bpmndi:BPMNEdge');
}

/** Resolve XML content from args.xml or args.filePath. Returns null + error result on failure. */
function resolveXml(args: ImportXmlArgs): { xml: string } | { error: ToolResult } {
  if (args.filePath) {
    if (!fs.existsSync(args.filePath)) {
      return { error: { content: [{ type: 'text', text: `File not found: ${args.filePath}` }] } };
    }
    return { xml: fs.readFileSync(args.filePath, 'utf-8') };
  }
  if (args.xml) return { xml: args.xml };
  return {
    error: { content: [{ type: 'text', text: 'Either xml or filePath must be provided.' }] },
  };
}

export async function handleImportXml(
  args: ImportXmlArgs,
  context?: ToolContext
): Promise<ToolResult> {
  const { autoLayout, filePath, draftMode } = args;

  const resolved = resolveXml(args);
  if ('error' in resolved) return resolved.error;

  let { xml } = resolved;
  const diagramId = generateDiagramId();
  const progress = context?.sendProgress;

  // Determine whether to run auto-layout
  const shouldLayout = autoLayout === true || (autoLayout === undefined && !xmlHasDiagramDI(xml));

  await progress?.(0, 100, 'Parsing BPMN XML…');

  if (shouldLayout) {
    await progress?.(10, 100, 'Generating initial DI coordinates…');
    // Step 1: bpmn-auto-layout generates DI (BPMNShape/BPMNEdge) for XML that lacks it
    const { layoutProcess } = await import('bpmn-auto-layout');
    xml = await layoutProcess(xml);
  }

  await progress?.(30, 100, 'Creating modeler…');
  const modeler = await createModelerFromXml(xml);

  // Resolve effective hint level: explicit hintLevel > draftMode > server default
  const hintLevel: HintLevel | undefined = args.hintLevel ?? (draftMode ? 'none' : undefined);
  const diagram = {
    modeler,
    xml,
    draftMode: draftMode ?? false,
    hintLevel,
  };

  if (shouldLayout) {
    await progress?.(50, 100, 'Running ELK auto-layout…');
    // Step 2: ELK layered algorithm improves layout quality
    await elkLayout(diagram);
    await syncXml(diagram);
  }

  await progress?.(90, 100, 'Storing diagram…');
  storeDiagram(diagramId, diagram);

  const result = jsonResult({
    success: true,
    diagramId,
    autoLayoutApplied: shouldLayout,
    ...(filePath ? { sourceFile: filePath } : {}),
    historyNote:
      'Import creates a fresh modeler with an empty undo/redo history. ' +
      'Use bpmn_history after making changes to undo/redo within this session.',
    message: `Imported BPMN diagram with ID: ${diagramId}${shouldLayout ? ' (auto-layout applied)' : ''}${filePath ? ` from ${filePath}` : ''}`,
    nextSteps: [
      {
        tool: 'list_bpmn_elements',
        description: 'List all elements in the imported diagram to understand its structure.',
      },
      {
        tool: 'validate_bpmn_diagram',
        description: 'Validate the imported diagram for lint issues and best practices.',
      },
      {
        tool: 'layout_bpmn_diagram',
        description: 'Apply automatic layout if the diagram needs visual cleanup.',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'import_bpmn_xml',
  description:
    'Import an existing BPMN XML diagram. If the XML lacks diagram coordinates (DI), auto-layout is applied ' +
    'using the ELK layered algorithm. Use autoLayout to force or skip auto-layout. ' +
    '**Warning:** Forcing autoLayout: true on diagrams that already have DI coordinates may reposition ' +
    'elements and can affect boundary event placement. For diagrams with boundary events, subprocesses, ' +
    'or complex structures, prefer autoLayout: false (or omit it to use auto-detection). ' +
    '**History:** Each import creates a fresh modeler with an empty undo/redo stack. ' +
    'Use bpmn_history to undo/redo changes made after import. ' +
    'Provide either xml (inline content) or filePath (read from disk). ' +
    'Combine with export_bpmn filePath to implement an open→edit→save workflow.',
  inputSchema: {
    type: 'object',
    properties: {
      xml: {
        type: 'string',
        description: 'The BPMN XML to import. Required unless filePath is provided.',
      },
      filePath: {
        type: 'string',
        description:
          'Path to a .bpmn file to read and import. When provided, xml parameter is ignored.',
      },
      autoLayout: {
        type: 'boolean',
        description:
          'Force (true) or skip (false) auto-layout. When omitted, auto-layout runs only if the XML has no diagram coordinates.',
      },
      draftMode: {
        type: 'boolean',
        description:
          'When true, suppress implicit lint feedback on every operation. ' +
          'Useful during incremental diagram editing to reduce noise. Default: false. ' +
          'Deprecated: use hintLevel instead.',
      },
      hintLevel: {
        type: 'string',
        enum: ['none', 'minimal', 'full'],
        description:
          "Controls implicit feedback verbosity. 'full' (default) includes " +
          "lint errors, layout hints, and connectivity warnings. 'minimal' " +
          "includes only lint errors. 'none' suppresses all implicit feedback " +
          '(equivalent to draftMode: true). Overrides draftMode when set.',
      },
    },
  },
} as const;
