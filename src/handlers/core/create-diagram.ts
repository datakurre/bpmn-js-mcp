/**
 * Handler for create_bpmn_diagram tool.
 */

import { type ToolResult, type HintLevel } from '../../types';
import { storeDiagram, generateDiagramId, createModeler } from '../../diagram-manager';
import { jsonResult, getService } from '../helpers';

export interface CreateDiagramArgs {
  name?: string;
  draftMode?: boolean;
  hintLevel?: HintLevel;
}

/** Convert a human name into a valid BPMN process id (XML NCName). */
function toProcessId(name: string): string {
  const sanitized = name
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .replace(/^[^a-zA-Z_]/, '_');
  return `Process_${sanitized || '1'}`;
}

export async function handleCreateDiagram(args: CreateDiagramArgs): Promise<ToolResult> {
  const diagramId = generateDiagramId();
  const modeler = await createModeler();
  const { xml } = await modeler.saveXML({ format: true });

  // If a name was provided, set it on the process along with a meaningful id
  if (args.name) {
    const elementRegistry = getService(modeler, 'elementRegistry');
    const modeling = getService(modeler, 'modeling');
    const process = elementRegistry.filter((el: any) => el.type === 'bpmn:Process')[0];
    if (process) {
      modeling.updateProperties(process, {
        name: args.name,
        id: toProcessId(args.name),
      });
    }
  }

  const savedXml = args.name ? (await modeler.saveXML({ format: true })).xml || '' : xml || '';

  // Resolve effective hint level: explicit hintLevel > draftMode > server default
  const hintLevel: HintLevel | undefined = args.hintLevel ?? (args.draftMode ? 'none' : undefined);

  storeDiagram(diagramId, {
    modeler,
    xml: savedXml,
    name: args.name,
    draftMode: args.draftMode ?? false,
    hintLevel,
  });

  const effectiveDraft = hintLevel === 'none' || (args.draftMode ?? false);

  return jsonResult({
    success: true,
    diagramId,
    name: args.name || undefined,
    draftMode: effectiveDraft,
    hintLevel: hintLevel ?? 'full',
    message: `Created new BPMN diagram with ID: ${diagramId}${effectiveDraft ? ' (draft mode — lint feedback suppressed)' : ''}`,
    nextSteps: [
      {
        tool: 'add_bpmn_element',
        description: 'Add a bpmn:StartEvent to begin building the process.',
      },
      {
        tool: 'import_bpmn_xml',
        description: 'Or import an existing BPMN XML file instead of building from scratch.',
      },
    ],
  });
}

export const TOOL_DEFINITION = {
  name: 'create_bpmn_diagram',
  description:
    'Create a new BPMN diagram. Returns a diagram ID that can be used with other tools. ' +
    'Use draftMode: true to suppress lint feedback during incremental construction.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Optional name for the diagram / process',
      },
      draftMode: {
        type: 'boolean',
        description:
          'When true, suppress implicit lint feedback on every operation. ' +
          'Useful during incremental diagram construction to reduce noise. ' +
          'Validation is still available via validate_bpmn_diagram, and ' +
          'export_bpmn still enforces its lint gate. Default: false. ' +
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
