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
  participantId?: string;
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
export interface AdjustLabelsArgs {
  diagramId: string;
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

export interface ExportSubprocessArgs {
  diagramId: string;
  elementId: string;
  format?: 'xml' | 'svg';
}

export interface SetScriptArgs {
  diagramId: string;
  elementId: string;
  scriptFormat: string;
  script: string;
  resultVariable?: string;
}

export interface CreateDataAssociationArgs {
  diagramId: string;
  sourceElementId: string;
  targetElementId: string;
}

export interface CreateCollaborationArgs {
  diagramId: string;
  participants: Array<{
    name: string;
    processId?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  }>;
}

export interface UndoChangeArgs {
  diagramId: string;
}

export interface RedoChangeArgs {
  diagramId: string;
}

export interface DiffDiagramsArgs {
  diagramIdA: string;
  diagramIdB: string;
}

export interface ResizeElementArgs {
  diagramId: string;
  elementId: string;
  width: number;
  height: number;
}

export interface BatchOperationsArgs {
  operations: Array<{
    tool: string;
    args: Record<string, any>;
  }>;
  stopOnError?: boolean;
}

export interface SetCamundaListenersArgs {
  diagramId: string;
  elementId: string;
  executionListeners?: Array<{
    event: string;
    class?: string;
    delegateExpression?: string;
    expression?: string;
    script?: { scriptFormat: string; value: string };
  }>;
  taskListeners?: Array<{
    event: string;
    class?: string;
    delegateExpression?: string;
    expression?: string;
    script?: { scriptFormat: string; value: string };
  }>;
}

export interface SetCallActivityVariablesArgs {
  diagramId: string;
  elementId: string;
  inMappings?: Array<{
    source?: string;
    sourceExpression?: string;
    target?: string;
    variables?: 'all';
    local?: boolean;
  }>;
  outMappings?: Array<{
    source?: string;
    sourceExpression?: string;
    target?: string;
    variables?: 'all';
    local?: boolean;
  }>;
}

export interface ManageRootElementsArgs {
  diagramId: string;
  messages?: Array<{ id: string; name?: string }>;
  signals?: Array<{ id: string; name?: string }>;
}

export interface SearchElementsArgs {
  diagramId: string;
  namePattern?: string;
  elementType?: string;
  property?: { key: string; value?: string };
}

export interface AutoConnectArgs {
  diagramId: string;
  elementIds: string[];
}

export interface DuplicateElementArgs {
  diagramId: string;
  elementId: string;
  offsetX?: number;
  offsetY?: number;
}

export interface MoveToLaneArgs {
  diagramId: string;
  elementId: string;
  laneId: string;
}

export interface InsertElementArgs {
  diagramId: string;
  flowId: string;
  elementType: string;
  name?: string;
}

export interface ReplaceElementArgs {
  diagramId: string;
  elementId: string;
  newType: string;
}

export interface SummarizeDiagramArgs {
  diagramId: string;
}
