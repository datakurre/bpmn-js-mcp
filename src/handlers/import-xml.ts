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

import { type ImportXmlArgs, type ToolResult } from '../types';
import { storeDiagram, generateDiagramId, createModelerFromXml } from '../diagram-manager';
import { jsonResult, syncXml } from './helpers';
import { appendLintFeedback } from '../linter';
import { elkLayout } from '../elk-layout';

/** Check whether BPMN XML contains diagram interchange (DI) coordinates. */
function xmlHasDiagramDI(xml: string): boolean {
  return xml.includes('bpmndi:BPMNShape') || xml.includes('bpmndi:BPMNEdge');
}

export async function handleImportXml(args: ImportXmlArgs): Promise<ToolResult> {
  const { xml, autoLayout } = args;
  const diagramId = generateDiagramId();

  // Determine whether to run auto-layout
  const shouldLayout = autoLayout === true || (autoLayout === undefined && !xmlHasDiagramDI(xml));

  let finalXml = xml;
  if (shouldLayout) {
    // Step 1: bpmn-auto-layout generates DI (BPMNShape/BPMNEdge) for XML that lacks it
    const { layoutProcess } = await import('bpmn-auto-layout');
    finalXml = await layoutProcess(xml);
  }

  const modeler = await createModelerFromXml(finalXml);
  const diagram = { modeler, xml: finalXml };

  if (shouldLayout) {
    // Step 2: ELK layered algorithm improves layout quality
    await elkLayout(diagram);
    await syncXml(diagram);
  }

  storeDiagram(diagramId, diagram);

  const result = jsonResult({
    success: true,
    diagramId,
    autoLayoutApplied: shouldLayout,
    message: `Imported BPMN diagram with ID: ${diagramId}${shouldLayout ? ' (auto-layout applied)' : ''}`,
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
    'or complex structures, prefer autoLayout: false (or omit it to use auto-detection).',
  inputSchema: {
    type: 'object',
    properties: {
      xml: { type: 'string', description: 'The BPMN XML to import' },
      autoLayout: {
        type: 'boolean',
        description:
          'Force (true) or skip (false) auto-layout. When omitted, auto-layout runs only if the XML has no diagram coordinates.',
      },
    },
    required: ['xml'],
  },
} as const;
