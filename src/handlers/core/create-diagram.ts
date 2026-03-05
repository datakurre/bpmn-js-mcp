/**
 * Handler for create_bpmn_diagram tool.
 */
// @mutating

import { type ToolResult, type HintLevel } from '../../types';
import {
  storeDiagram,
  generateDiagramId,
  createModeler,
  createModelerFromXml,
} from '../../diagram-manager';
import { jsonResult, getService, getProcesses } from '../helpers';

/** Workflow context hint for guiding pool/lane usage. */
export type WorkflowContext = 'single-organization' | 'multi-organization' | 'multi-system';

export interface CreateDiagramArgs {
  name?: string;
  draftMode?: boolean;
  hintLevel?: HintLevel;
  /**
   * Optional hint about the workflow context.
   * - 'single-organization': suggests using lanes for role separation
   * - 'multi-organization': suggests using collaboration with separate pools
   * - 'multi-system': requires collaboration with message flows between systems
   */
  workflowContext?: WorkflowContext;
  /**
   * Clone an existing diagram instead of creating a blank one.
   * Provide the diagram ID to clone from.
   */
  cloneFrom?: string;
  /**
   * When true (default), every mutating tool response appends an ImageContent item with
   * the current diagram rendered as a base64-encoded PNG (mimeType: image/png).
   * Set to false to keep responses small (e.g. in CI or batch mode). Default: true.
   */
  includeImage?: boolean;
}

/** Convert a human name into a valid BPMN process id (XML NCName). */
function toProcessId(name: string): string {
  const sanitized = name
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/^[^a-zA-Z_]/, '_');
  return `Process_${sanitized || '1'}`;
}

/** Workflow-context guidance table. */
const WORKFLOW_CONTEXT_GUIDANCE: Record<
  WorkflowContext,
  { guidance: string; step: { tool: string; description: string } }
> = {
  'single-organization': {
    guidance:
      'For role separation within one organization, use a single pool with lanes. ' +
      'Create a participant in one call using the `lanes` parameter (e.g. ' +
      '`create_bpmn_participant` with `lanes: [{ name: "Customer" }, { name: "Store" }]`). ' +
      'This avoids multiple expanded pools, which are discouraged in Camunda 7 / Operaton ' +
      'because only one pool is executable.',
    step: {
      tool: 'create_bpmn_participant',
      description:
        'Create a single expanded pool with lanes in one call: ' +
        'use the `lanes` parameter (e.g. `lanes: [{ name: "Customer" }, { name: "Store" }]`) ' +
        'rather than calling create_bpmn_lanes separately. ' +
        'Multiple expanded pools are not recommended for single-organization workflows.',
    },
  },
  'multi-organization': {
    guidance:
      'For separate organizations communicating via messages, use a collaboration ' +
      'with one executable pool and collapsed partner pools for external parties. ' +
      'Connect them with message flows.',
    step: {
      tool: 'create_bpmn_participant',
      description:
        'Create a collaboration with participants array: one expanded pool (your process) and collapsed pools for external partners.',
    },
  },
  'multi-system': {
    guidance:
      'For system-to-system integration, use a collaboration with pools per system. ' +
      'Only one pool is executable (Camunda 7); others are collapsed message flow endpoints. ' +
      'For simple integrations, consider ServiceTask with external topic instead.',
    step: {
      tool: 'create_bpmn_participant',
      description:
        'Create a collaboration with participants array: expanded pool for your process and collapsed pools for external systems.',
    },
  },
};

/** Append PNG image content to a ToolResult (non-fatal). */
async function appendPngImage(result: ToolResult, modeler: any): Promise<void> {
  try {
    const { svgToPng } = await import('../../svg-to-png');
    const { svg } = await modeler.saveSVG();
    const pngBuffer = svgToPng(svg);
    const base64 = pngBuffer.toString('base64');
    result.content.push({
      type: 'image',
      data: base64,
      mimeType: 'image/png',
      annotations: { audience: ['user'] },
    });
  } catch {
    // Non-fatal — image conversion should never break the primary operation
  }
}

/** Handle clone mode: duplicate an existing diagram. */
async function cloneDiagram(args: CreateDiagramArgs): Promise<ToolResult> {
  const { requireDiagram } = await import('../helpers');
  const source = requireDiagram(args.cloneFrom!);
  const { xml } = await source.modeler.saveXML({ format: true });
  const newDiagramId = generateDiagramId();
  const modeler = await createModelerFromXml(xml || '');
  storeDiagram(newDiagramId, {
    modeler,
    xml: xml || '',
    name: args.name || source.name,
    includeImage: args.includeImage ?? source.includeImage,
  });
  return jsonResult({
    success: true,
    diagramId: newDiagramId,
    clonedFrom: args.cloneFrom,
    name: args.name || source.name,
    message: `Cloned diagram ${args.cloneFrom} → ${newDiagramId}`,
  });
}

export async function handleCreateDiagram(args: CreateDiagramArgs): Promise<ToolResult> {
  // Clone mode: duplicate an existing diagram
  if (args.cloneFrom) {
    return cloneDiagram(args);
  }

  const diagramId = generateDiagramId();
  const modeler = await createModeler();
  const { xml } = await modeler.saveXML({ format: true });

  // If a name was provided, set it on the process along with a meaningful id
  if (args.name) {
    const elementRegistry = getService(modeler, 'elementRegistry');
    const modeling = getService(modeler, 'modeling');
    const process = getProcesses(elementRegistry)[0];
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
    includeImage: args.includeImage ?? true,
  });

  const effectiveDraft = hintLevel === 'none' || (args.draftMode ?? false);

  const nextSteps: Array<{ tool: string; description: string }> = [];
  const resultData: Record<string, any> = {
    success: true,
    diagramId,
    name: args.name || undefined,
    draftMode: effectiveDraft,
    hintLevel: hintLevel ?? 'full',
    message: `Created new BPMN diagram with ID: ${diagramId}${effectiveDraft ? ' (draft mode — lint feedback suppressed)' : ''}`,
  };

  if (args.workflowContext) {
    const ctx = WORKFLOW_CONTEXT_GUIDANCE[args.workflowContext];
    resultData.workflowContext = args.workflowContext;
    resultData.structureGuidance = ctx.guidance;
    nextSteps.push(ctx.step);
  }

  nextSteps.push(
    {
      tool: 'add_bpmn_element',
      description: 'Add a bpmn:StartEvent to begin building the process.',
    },
    {
      tool: 'import_bpmn_xml',
      description: 'Or import an existing BPMN XML file instead of building from scratch.',
    }
  );
  resultData.nextSteps = nextSteps;

  const result = jsonResult(resultData);

  // Append PNG image content when includeImage is set (default: true)
  const effectiveIncludeImage = args.includeImage ?? true;
  if (effectiveIncludeImage) {
    await appendPngImage(result, modeler);
  }

  return result;
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
      workflowContext: {
        type: 'string',
        enum: ['single-organization', 'multi-organization', 'multi-system'],
        description:
          "Optional hint about the workflow context. 'single-organization' " +
          'suggests using lanes for role separation within one pool. ' +
          "'multi-organization' suggests using collaboration with separate pools " +
          "for distinct organizations. 'multi-system' requires collaboration " +
          'with message flows between technical systems. Adds structural guidance ' +
          'to the response to help choose the right modeling approach.',
      },
      cloneFrom: {
        type: 'string',
        description:
          'Clone an existing diagram instead of creating a blank one. ' +
          'Provide the diagram ID to clone from. Returns a new diagram ID.',
      },
      includeImage: {
        type: 'boolean',
        description:
          'When true (default), every mutating tool response appends an ImageContent item with the current ' +
          'diagram rendered as a base64-encoded PNG (mimeType: image/png). ' +
          'Set to false to keep responses small (e.g. in CI pipelines or batch processing). ' +
          'Suitable for visual UIs that display a live diagram preview after each change.',
      },
    },
  },
} as const;
