/**
 * Shared interfaces used across the BPMN-MCP server.
 */

// ── Diagram state ──────────────────────────────────────────────────────────

/** Minimal interface for the bpmn-js Modeler services we use. */
export interface BpmnModeler {
  get(service: string): any;
  saveXML(options?: { format?: boolean }): Promise<{ xml: string }>;
  saveSVG(): Promise<{ svg: string }>;
  importXML(xml: string): Promise<any>;
}

/** State for a single in-memory BPMN diagram. */
export interface DiagramState {
  modeler: BpmnModeler;
  xml: string;
  name?: string;
}

/** Shape of the JSON returned by tool handlers that wrap results. */
export interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

// ── Tool argument interfaces ───────────────────────────────────────────────

export interface CreateDiagramArgs {
  name?: string;
}

export interface AddElementArgs {
  diagramId: string;
  elementType: string;
  name?: string;
  x?: number;
  y?: number;
  hostElementId?: string;
  afterElementId?: string;
}

export interface ConnectArgs {
  diagramId: string;
  sourceElementId: string;
  targetElementId: string;
  label?: string;
  connectionType?: string;
  conditionExpression?: string;
  isDefault?: boolean;
}

export interface ExportArgs {
  diagramId: string;
}

export interface ListElementsArgs {
  diagramId: string;
}

export interface SetPropertiesArgs {
  diagramId: string;
  elementId: string;
  properties: Record<string, any>;
}

export interface ImportXmlArgs {
  xml: string;
}

export interface DeleteElementArgs {
  diagramId: string;
  elementId: string;
}

export interface MoveElementArgs {
  diagramId: string;
  elementId: string;
  x: number;
  y: number;
}

export interface GetPropertiesArgs {
  diagramId: string;
  elementId: string;
}

export interface DeleteDiagramArgs {
  diagramId: string;
}

export interface CloneDiagramArgs {
  diagramId: string;
  name?: string;
}

export interface ValidateArgs {
  diagramId: string;
}

export interface AlignElementsArgs {
  diagramId: string;
  elementIds: string[];
  alignment: "left" | "center" | "right" | "top" | "middle" | "bottom";
  compact?: boolean;
}

export interface DistributeElementsArgs {
  diagramId: string;
  elementIds: string[];
  orientation: "horizontal" | "vertical";
  gap?: number;
}

export interface SetInputOutputArgs {
  diagramId: string;
  elementId: string;
  inputParameters?: Array<{ name: string; value?: string }>;
  outputParameters?: Array<{ name: string; value?: string }>;
}

export interface SetEventDefinitionArgs {
  diagramId: string;
  elementId: string;
  eventDefinitionType: string;
  properties?: Record<string, any>;
  errorRef?: { id: string; name?: string; errorCode?: string };
}

export interface SetFormDataArgs {
  diagramId: string;
  elementId: string;
  businessKey?: string;
  fields: Array<{
    id: string;
    label: string;
    type: string;
    defaultValue?: string;
    datePattern?: string;
    properties?: Record<string, string>;
    validation?: Array<{ name: string; config?: string }>;
    values?: Array<{ id: string; name: string }>;
  }>;
}

export interface LayoutDiagramArgs {
  diagramId: string;
}

export interface SetCamundaErrorEventDefinitionArgs {
  diagramId: string;
  elementId: string;
  errorDefinitions: Array<{
    id: string;
    expression?: string;
    errorRef?: { id: string; name?: string; errorCode?: string };
  }>;
}

export interface LintDiagramArgs {
  diagramId: string;
  config?: {
    extends?: string | string[];
    rules?: Record<string, string | number | [string | number, any]>;
  };
}
export interface AdjustLabelsArgs { diagramId: string; }
export interface SetLoopCharacteristicsArgs {
  diagramId: string;
  elementId: string;
  loopType: "none" | "standard" | "parallel" | "sequential";
  loopCondition?: string;
  loopMaximum?: number;
  loopCardinality?: string;
  completionCondition?: string;
  collection?: string;
  elementVariable?: string;
}

