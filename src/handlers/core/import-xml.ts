/**
 * Internal handler backing create_bpmn_diagram's xml/filePath import mode.
 *
 * Former standalone import_bpmn_xml tool, folded into create_bpmn_diagram
 * and removed outright (no hidden alias) — see ADR-030. Kept as a plain
 * exported function since create-diagram.ts calls it directly, and many
 * existing tests call it directly too.
 *
 * Supports an optional `autoLayout` boolean:
 *  - `true`:  always run auto-layout after import
 *  - `false`: never run auto-layout (use embedded DI as-is)
 *  - omitted: auto-detect — run layout only if the XML lacks DI coordinates
 *
 * When layout is needed, bpmn-auto-layout generates the DI (diagram
 * interchange) coordinates before the XML is loaded into the modeler.
 */
// @mutating

import { type ToolResult, type HintLevel, type ToolContext } from '../../types';
import { storeDiagram, generateDiagramId, createModelerFromXml } from '../../diagram-manager';
import { jsonResult } from '../helpers';
import { appendLintFeedback } from '../../linter';
import { runAutoLayout } from '../../auto-layout';
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

/**
 * Check whether BPMN XML contains usable diagram interchange (DI) coordinates.
 *
 * Returns `true` only when:
 * 1. The XML includes `bpmndi:BPMNShape` or `bpmndi:BPMNEdge` elements, AND
 * 2. At least one shape has a non-zero `width` attribute on its `Bounds` element.
 *
 * The second check catches XML that has a `BPMNDiagram` section with shape
 * elements whose bounds are all zero or absent — these diagrams lack real DI
 * coordinates and should be auto-laid-out just like DI-free XML.
 */
function xmlHasDiagramDI(xml: string): boolean {
  if (!xml.includes('bpmndi:BPMNShape') && !xml.includes('bpmndi:BPMNEdge')) return false;
  // Verify that at least one Bounds element has a non-zero width attribute.
  // Matches patterns like:  width="100"  or  dc:width="50"
  return /Bounds[^>]*\swidth="[1-9]/.test(xml);
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
    await progress?.(10, 100, 'Running auto-layout…');
    // bpmn-auto-layout (re)generates DI (BPMNShape/BPMNEdge) for the whole diagram
    ({ xml } = await runAutoLayout(xml));
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
