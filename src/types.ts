/**
 * Shared interfaces used across the bpmn-js-mcp server.
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
  /** When true, suppress implicit lint feedback on mutating operations. */
  draftMode?: boolean;
}

/** Shape of the JSON returned by tool handlers that wrap results. */
export interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

// ── Tool argument interfaces ───────────────────────────────────────────────

export interface CreateDiagramArgs {
  name?: string;
  draftMode?: boolean;
}

export interface AddElementArgs {
  diagramId: string;
  elementType: string;
  name?: string;
  x?: number;
  y?: number;
  hostElementId?: string;
  afterElementId?: string;
  participantId?: string;
  /** Boundary event shorthand: set event definition type in one call. */
  eventDefinitionType?: string;
  /** Boundary event shorthand: event definition properties (timer, condition, etc.). */
  eventDefinitionProperties?: Record<string, any>;
  /** Boundary event shorthand: error reference for ErrorEventDefinition. */
  errorRef?: { id: string; name?: string; errorCode?: string };
  /** Boundary event shorthand: message reference for MessageEventDefinition. */
  messageRef?: { id: string; name?: string };
  /** Boundary event shorthand: signal reference for SignalEventDefinition. */
  signalRef?: { id: string; name?: string };
  /** Boundary event shorthand: escalation reference for EscalationEventDefinition. */
  escalationRef?: { id: string; name?: string; escalationCode?: string };
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

export interface SetPropertiesArgs {
  diagramId: string;
  elementId: string;
  properties: Record<string, any>;
}

export interface ImportXmlArgs {
  xml?: string;
  filePath?: string;
  autoLayout?: boolean;
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
  config?: {
    extends?: string | string[];
    rules?: Record<string, string | number | [string | number, any]>;
  };
  lintMinSeverity?: 'error' | 'warning';
}

export interface AlignElementsArgs {
  diagramId: string;
  elementIds: string[];
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
  compact?: boolean;
}

export interface DistributeElementsArgs {
  diagramId: string;
  elementIds: string[];
  orientation: 'horizontal' | 'vertical';
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
  messageRef?: { id: string; name?: string };
  signalRef?: { id: string; name?: string };
  escalationRef?: { id: string; name?: string; escalationCode?: string };
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
  direction?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
  nodeSpacing?: number;
  layerSpacing?: number;
  scopeElementId?: string;
  preserveHappyPath?: boolean;
  compactness?: 'compact' | 'spacious';
  simplifyRoutes?: boolean;
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

export interface SetLoopCharacteristicsArgs {
  diagramId: string;
  elementId: string;
  loopType: 'none' | 'standard' | 'parallel' | 'sequential';
  loopCondition?: string;
  loopMaximum?: number;
  loopCardinality?: string;
  completionCondition?: string;
  collection?: string;
  elementVariable?: string;
}

export interface DuplicateElementArgs {
  diagramId: string;
  elementId: string;
  offsetX?: number;
  offsetY?: number;
}
