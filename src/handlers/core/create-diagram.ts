/**
 * Handler for create_bpmn_diagram tool.
 */
// @mutating

import {
  type ToolResult,
  type HintLevel,
  type IncludeImage,
  type IncludeImageFormat,
  resolveIncludeFormats,
} from '../../types';
import {
  storeDiagram,
  generateDiagramId,
  createModeler,
  createModelerFromXml,
} from '../../diagram-manager';
import { jsonResult, getService, getProcesses } from '../helpers';
import { appendMcpAppContent } from '../../linter';

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
   * Which image formats to append to every mutating tool response.
   * - `['png']`        — 2× resolution PNG only (default when omitted)
   * - `['svg']`        — cropped SVG only
   * - `['png', 'svg']` — both formats
   * - `true`           — shorthand for `['png']`
   * - `false`          — no images
   */
  includeImage?: IncludeImage;
  /**
   * When true, every mutating tool response also embeds the diagram's
   * current XML for MCP Apps-capable hosts to render an interactive
   * `ui://bpmn-diagram-viewer` view (issue #11). Independent of
   * `includeImage`. Default: false.
   */
  includeAppView?: boolean;
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

/** Append requested image formats to a ToolResult (non-fatal). */
async function appendImages(
  result: ToolResult,
  modeler: any,
  formats: IncludeImageFormat[]
): Promise<void> {
  if (formats.length === 0) return;
  try {
    const { svgToPngWithFallback, tightenSvgViewBox } = await import('bpmn-to-image');
    const { svg } = await modeler.saveSVG();
    // Same viewBox-tightening as appendImageContent() in linter.ts, so
    // includeImage SVG/PNG output matches the export_bpmn SVG regardless
    // of which tool produced it (ADR-022).
    let allElements: any[] | undefined;
    try {
      allElements = modeler.get('elementRegistry').getAll();
    } catch {
      // elementRegistry not available — fall back to origin-strip only
    }
    const tightSvg = tightenSvgViewBox(svg || '', allElements);

    if (formats.includes('png')) {
      const { data: pngData, mimeType: pngMime } = svgToPngWithFallback(tightSvg);
      result.content.push({
        type: 'image',
        data: pngData.toString('base64'),
        mimeType: pngMime,
        annotations: { audience: ['user'] },
      });
    }

    if (formats.includes('svg')) {
      const base64Svg = Buffer.from(tightSvg, 'utf-8').toString('base64');
      result.content.push({
        type: 'image',
        data: base64Svg,
        mimeType: 'image/svg+xml',
        annotations: { audience: ['user'] },
      });
    }
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
    includeAppView: args.includeAppView ?? source.includeAppView,
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

  const diagramState = {
    modeler,
    xml: savedXml,
    name: args.name,
    draftMode: args.draftMode ?? false,
    hintLevel,
    includeImage: args.includeImage ?? ['png'],
    includeAppView: args.includeAppView ?? false,
  };
  storeDiagram(diagramId, diagramState);

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

  // Append image(s) when includeImage is set (default: ['png'])
  const formats = resolveIncludeFormats(args.includeImage ?? ['png']);
  await appendImages(result, modeler, formats);

  if (args.includeAppView) {
    await appendMcpAppContent(result, diagramState);
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
        description:
          'List of image formats to append to every mutating tool response. ' +
          "Pass ['png'] for a 2\u00d7-resolution PNG, ['svg'] for a cropped SVG, " +
          "or ['png', 'svg'] for both. " +
          "Also accepts boolean: true = ['png'] (default when omitted), false = no images. " +
          'Set to [] or false to keep responses small (CI / batch mode).',
        anyOf: [
          {
            type: 'array',
            items: { type: 'string', enum: ['png', 'svg'] },
          },
          { type: 'boolean' },
        ],
      },
      includeAppView: {
        type: 'boolean',
        description:
          "When true, every mutating tool response also embeds the diagram's current XML " +
          "for MCP Apps-capable hosts (see the 'ui://bpmn-diagram-viewer' resource) to render " +
          'an interactive, pannable/zoomable view inline in the conversation, instead of (or ' +
          'alongside) includeImage. Independent of includeImage. Default: false.',
      },
    },
  },
} as const;
