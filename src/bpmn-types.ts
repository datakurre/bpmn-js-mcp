/**
 * Minimal type interfaces for bpmn-js services and elements.
 *
 * bpmn-js doesn't ship proper TypeScript declarations for its internal
 * services.  These interfaces capture the subset of the API we actually
 * use so that handler code can avoid raw `any` and get basic IDE
 * auto-complete / type-checking.
 */

// ── BPMN Element types ─────────────────────────────────────────────────────

/** Minimal representation of a BPMN business object (semantic model). */
export interface BusinessObject {
  $type: string;
  $parent?: BusinessObject;
  $attrs?: Record<string, unknown>;
  id: string;
  name?: string;
  default?: BusinessObject;
  eventDefinitions?: EventDefinition[];
  extensionElements?: ExtensionElements;
  loopCharacteristics?: unknown;
  conditionExpression?: unknown;
  incoming?: BusinessObject[];
  outgoing?: BusinessObject[];
  /* Camunda-specific attributes (set via moddle descriptor) */
  assignee?: string;
  topic?: string;
  type?: string;
  [key: string]: unknown;
}

/** Minimal event definition on a business object. */
export interface EventDefinition {
  $type: string;
  $parent?: BusinessObject;
  errorRef?: BusinessObject;
  [key: string]: unknown;
}

/** extensionElements container. */
export interface ExtensionElements {
  $type: string;
  $parent?: BusinessObject;
  values: ExtensionElement[];
}

/** A single extension element (camunda:InputOutput, camunda:FormData, etc.). */
export interface ExtensionElement {
  $type: string;
  $parent?: ExtensionElements;
  [key: string]: unknown;
}

// ── Diagram-JS shape / element ─────────────────────────────────────────────

/** A shape or connection on the canvas — wraps a BusinessObject. */
export interface BpmnElement {
  id: string;
  type: string;
  businessObject: BusinessObject;
  x: number;
  y: number;
  width: number;
  height: number;
  incoming?: BpmnElement[];
  outgoing?: BpmnElement[];
  source?: BpmnElement;
  target?: BpmnElement;
  parent?: BpmnElement;
}

// ── bpmn-js service interfaces ─────────────────────────────────────────────

/** The Modeling service — mutates the model & diagram. */
export interface Modeling {
  createShape(
    shape: BpmnElement | Record<string, unknown>,
    position: { x: number; y: number },
    target: BpmnElement | Record<string, unknown>,
    hints?: Record<string, unknown>
  ): BpmnElement;
  moveElements(elements: BpmnElement[], delta: { x: number; y: number }): void;
  layoutConnection(connection: BpmnElement, hints?: Record<string, unknown>): void;
  updateWaypoints(
    connection: BpmnElement,
    newWaypoints: Array<{ x: number; y: number }>,
    hints?: Record<string, unknown>
  ): void;
  connect(source: BpmnElement, target: BpmnElement, attrs?: Record<string, unknown>): BpmnElement;
  updateProperties(element: BpmnElement, properties: Record<string, unknown>): void;
  removeElements(elements: BpmnElement[]): void;
}

/** The ElementFactory service — creates new shapes / connections. */
export interface ElementFactory {
  createShape(attrs: Record<string, unknown>): BpmnElement;
  createConnection(attrs: Record<string, unknown>): BpmnElement;
}

/** The ElementRegistry service — find / filter elements. */
export interface ElementRegistry {
  get(id: string): BpmnElement | undefined;
  filter(fn: (element: BpmnElement) => boolean): BpmnElement[];
  getAll(): BpmnElement[];
  forEach(fn: (element: BpmnElement) => void): void;
}

/** The Canvas service — root element access. */
export interface Canvas {
  getRootElement(): BpmnElement;
}

/** The Moddle service — create BPMN model instances. */
export interface Moddle {
  create(type: string, attrs?: Record<string, unknown>): BusinessObject;
}
