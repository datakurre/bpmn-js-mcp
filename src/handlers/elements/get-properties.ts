/**
 * Element property-detail serialization, plus the internal handleGetProperties
 * function (no longer a registered MCP tool — see ADR-027; get_bpmn_element_properties
 * was removed outright rather than kept as a hidden alias, per #23).
 *
 * Returns standard BPMN attributes, Camunda extension properties,
 * extension elements (I/O mapping, form data), connections, and
 * event definitions for a given element.
 */
// @readonly

import { type ToolResult } from '../../types';
import { requireDiagram, requireElement, jsonResult, validateArgs, getService } from '../helpers';

export interface GetPropertiesArgs {
  diagramId: string;
  elementId: string;
}

// ── Sub-function: Camunda extension attributes ─────────────────────────────

/** Known Camunda properties that may appear directly on the business object. */
const CAMUNDA_DIRECT_PROPS = [
  'assignee',
  'candidateGroups',
  'candidateUsers',
  'dueDate',
  'followUpDate',
  'formKey',
  'formRef',
  'priority',
  'class',
  'delegateExpression',
  'expression',
  'resultVariable',
  'topic',
  'type',
  'errorCodeVariable',
  'errorMessageVariable',
  'asyncBefore',
  'asyncAfter',
  'exclusive',
  'jobPriority',
  'taskPriority',
  'historyTimeToLive',
  'isStartableInTasklist',
  'versionTag',
  'resource',
] as const;

function serializeCamundaAttrs(bo: any): Record<string, any> | undefined {
  const camundaAttrs: Record<string, any> = {};
  // From $attrs (explicit namespace prefixed attributes)
  if (bo.$attrs) {
    for (const [key, value] of Object.entries(bo.$attrs)) {
      if (key.startsWith('camunda:')) {
        camundaAttrs[key] = value;
      }
    }
  }
  // From direct BO properties (camunda moddle descriptor)
  for (const prop of CAMUNDA_DIRECT_PROPS) {
    if (bo[prop] !== undefined && bo[prop] !== null) {
      camundaAttrs[`camunda:${prop}`] = bo[prop];
    }
  }
  return Object.keys(camundaAttrs).length > 0 ? camundaAttrs : undefined;
}

// ── Sub-function: InputOutput extension serialisation ──────────────────────

function serializeParameter(p: any): Record<string, any> {
  const result: Record<string, any> = { name: p.name };
  if (p.value !== undefined) result.value = p.value;
  if (p.definition) {
    const def = p.definition;
    if (def.$type === 'camunda:List' && def.items) {
      result.list = def.items.map((item: any) => item.value ?? item);
    } else if (def.$type === 'camunda:Map' && def.entries) {
      result.map = def.entries.reduce((acc: Record<string, string>, entry: any) => {
        acc[entry.key] = entry.value;
        return acc;
      }, {});
    } else if (def.$type === 'camunda:Script') {
      result.script = {
        scriptFormat: def.scriptFormat,
        ...(def.resource ? { resource: def.resource } : { value: def.value }),
      };
    }
  }
  return result;
}

function serializeInputOutput(ext: any): Record<string, any> {
  const io: any = { type: 'camunda:InputOutput' };
  if (ext.inputParameters) {
    io.inputParameters = ext.inputParameters.map(serializeParameter);
  }
  if (ext.outputParameters) {
    io.outputParameters = ext.outputParameters.map(serializeParameter);
  }
  return io;
}

// ── Sub-function: FormData extension serialisation ─────────────────────────

function serializeFormField(f: any): Record<string, any> {
  const field: any = {
    id: f.id,
    label: f.label,
    type: f.type,
    defaultValue: f.defaultValue,
  };
  if (f.datePattern) field.datePattern = f.datePattern;
  if (f.values?.length) {
    field.values = f.values.map((v: any) => ({ id: v.id, name: v.name }));
  }
  if (f.validation?.constraints?.length) {
    field.validation = f.validation.constraints.map((c: any) => ({
      name: c.name,
      config: c.config,
    }));
  }
  if (f.properties?.values?.length) {
    field.properties = f.properties.values.reduce((acc: Record<string, string>, p: any) => {
      acc[p.id] = p.value;
      return acc;
    }, {});
  }
  return field;
}

function serializeFormData(ext: any): Record<string, any> {
  const fd: any = { type: 'camunda:FormData' };
  if (ext.fields) {
    fd.fields = ext.fields.map(serializeFormField);
  }
  if (ext.businessKey) fd.businessKey = ext.businessKey;
  return fd;
}

// ── Sub-function: all extension elements ───────────────────────────────────

// ── Sub-function: Listener extension serialisation ─────────────────────────

function serializeListener(ext: any): Record<string, any> {
  const listener: Record<string, any> = { type: ext.$type, event: ext.event };
  if (ext['class']) listener.class = ext['class'];
  if (ext.delegateExpression) listener.delegateExpression = ext.delegateExpression;
  if (ext.expression) listener.expression = ext.expression;
  if (ext.script) {
    listener.script = {
      scriptFormat: ext.script.scriptFormat,
      value: ext.script.value,
    };
  }
  if (ext.fields?.length) {
    listener.fields = ext.fields.map((f: any) => {
      const field: Record<string, any> = { name: f.name };
      if (f.stringValue != null) field.stringValue = f.stringValue;
      if (f.string != null) field.string = f.string;
      if (f.expression != null) field.expression = f.expression;
      return field;
    });
  }
  return listener;
}

// ── Sub-function: camunda:In / camunda:Out serialisation ───────────────────

function serializeInOut(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: ext.$type };
  if (ext.source) result.source = ext.source;
  if (ext.target) result.target = ext.target;
  if (ext.sourceExpression) result.sourceExpression = ext.sourceExpression;
  if (ext.variables) result.variables = ext.variables;
  if (ext.local) result.local = ext.local;
  if (ext.businessKey) result.businessKey = ext.businessKey;
  return result;
}

// ── Sub-function: camunda:FailedJobRetryTimeCycle serialisation ─────────────

function serializeRetryTimeCycle(ext: any): Record<string, any> {
  return { type: ext.$type, body: ext.body };
}

// ── Sub-function: camunda:Connector serialisation ──────────────────────────

function serializeConnector(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: ext.$type };
  if (ext.connectorId) result.connectorId = ext.connectorId;
  if (ext.inputOutput) result.inputOutput = serializeInputOutput(ext.inputOutput);
  return result;
}

// ── Sub-function: camunda:Properties serialisation ─────────────────────────

function serializeCamundaProperties(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: ext.$type };
  if (ext.values?.length) {
    result.properties = ext.values.reduce((acc: Record<string, string>, p: any) => {
      acc[p.name || p.id] = p.value;
      return acc;
    }, {});
  }
  return result;
}

// ── Sub-function: camunda:ErrorEventDefinition serialisation ───────────────

function serializeCamundaErrorDefinition(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: ext.$type };
  if (ext.expression) result.expression = ext.expression;
  if (ext.errorRef) {
    result.errorRef = {
      id: ext.errorRef.id,
      name: ext.errorRef.name,
      errorCode: ext.errorRef.errorCode,
    };
  }
  return result;
}

// ── Sub-function: all extension elements ───────────────────────────────────

/** Type → serialiser mapping for known extension element types. */
const EXTENSION_SERIALIZERS: Record<string, (ext: any) => Record<string, any>> = {
  'camunda:InputOutput': serializeInputOutput,
  'camunda:FormData': serializeFormData,
  'camunda:ExecutionListener': serializeListener,
  'camunda:TaskListener': serializeListener,
  'camunda:In': serializeInOut,
  'camunda:Out': serializeInOut,
  'camunda:FailedJobRetryTimeCycle': serializeRetryTimeCycle,
  'camunda:Connector': serializeConnector,
  'camunda:Properties': serializeCamundaProperties,
  'camunda:ErrorEventDefinition': serializeCamundaErrorDefinition,
};

function serializeExtensionElements(bo: any): any[] | undefined {
  if (!bo.extensionElements?.values) return undefined;

  const extensions: any[] = [];
  for (const ext of bo.extensionElements.values) {
    const serializer = EXTENSION_SERIALIZERS[ext.$type];
    extensions.push(serializer ? serializer(ext) : { type: ext.$type });
  }
  return extensions.length > 0 ? extensions : undefined;
}

// ── Sub-function: connections ──────────────────────────────────────────────

function serializeConnections(element: any): { incoming?: any[]; outgoing?: any[] } {
  const result: { incoming?: any[]; outgoing?: any[] } = {};
  if (element.incoming?.length) {
    result.incoming = element.incoming.map((c: any) => ({
      id: c.id,
      type: c.type,
      sourceId: c.source?.id,
    }));
  }
  if (element.outgoing?.length) {
    result.outgoing = element.outgoing.map((c: any) => ({
      id: c.id,
      type: c.type,
      targetId: c.target?.id,
    }));
  }
  return result;
}

// ── Sub-function: event definitions ────────────────────────────────────────

function serializeEventDefinitions(bo: any): any[] | undefined {
  if (!bo.eventDefinitions?.length) return undefined;
  return bo.eventDefinitions.map((ed: any) => {
    const def: any = { type: ed.$type };
    if (ed.errorRef) {
      def.errorRef = {
        id: ed.errorRef.id,
        name: ed.errorRef.name,
        errorCode: ed.errorRef.errorCode,
      };
      if (ed.errorRef.errorMessage) def.errorRef.errorMessage = ed.errorRef.errorMessage;
    }
    if (ed.messageRef) {
      def.messageRef = { id: ed.messageRef.id, name: ed.messageRef.name };
    }
    if (ed.signalRef) {
      def.signalRef = { id: ed.signalRef.id, name: ed.signalRef.name };
    }
    if (ed.escalationRef) {
      def.escalationRef = {
        id: ed.escalationRef.id,
        name: ed.escalationRef.name,
        escalationCode: ed.escalationRef.escalationCode,
      };
    }
    // Timer properties
    if (ed.timeDuration) def.timeDuration = ed.timeDuration.body;
    if (ed.timeDate) def.timeDate = ed.timeDate.body;
    if (ed.timeCycle) def.timeCycle = ed.timeCycle.body;
    // Conditional properties
    if (ed.condition) def.condition = ed.condition.body;
    // Link properties
    if (ed.name) def.name = ed.name;
    // Camunda extensions on event definitions
    if (ed.errorCodeVariable) def['camunda:errorCodeVariable'] = ed.errorCodeVariable;
    if (ed.errorMessageVariable) def['camunda:errorMessageVariable'] = ed.errorMessageVariable;
    if (ed.variableName) def['camunda:variableName'] = ed.variableName;
    if (ed.variableEvents) def['camunda:variableEvents'] = ed.variableEvents;
    return def;
  });
}

// ── Main handler ───────────────────────────────────────────────────────────

/**
 * Build the full property-detail object for one element: standard BPMN
 * attributes, Camunda extension properties, extension elements, connections,
 * and event definitions. Shared by the internal `handleGetProperties` (used
 * directly by tests, no longer a registered tool) and `list_bpmn_elements`'s
 * `elementIds` mode — see ADR-027.
 */
export function buildElementDetail(element: any): Record<string, any> {
  const bo = element.businessObject;

  const result: Record<string, any> = {
    id: bo.id,
    type: element.type,
    name: bo.name,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };

  // For boundary events, include host element reference and cancelActivity
  if (element.type === 'bpmn:BoundaryEvent') {
    const attachedToRef = bo.attachedToRef as { id?: string } | undefined;
    const hostId = element.host?.id || attachedToRef?.id;
    if (hostId) {
      result.attachedToRef = hostId;
    }
    // cancelActivity: true = interrupting (default), false = non-interrupting
    result.cancelActivity = bo.cancelActivity !== false; // bpmn-js default is true
    if (bo.cancelActivity === false) {
      result.cancelActivity = false;
    }
  }

  const camunda = serializeCamundaAttrs(bo);
  if (camunda) result.camundaProperties = camunda;

  const extensions = serializeExtensionElements(bo);
  if (extensions) result.extensionElements = extensions;

  const connections = serializeConnections(element);
  if (connections.incoming) result.incoming = connections.incoming;
  if (connections.outgoing) result.outgoing = connections.outgoing;

  const eventDefs = serializeEventDefinitions(bo);
  if (eventDefs) result.eventDefinitions = eventDefs;

  return result;
}

export async function handleGetProperties(args: GetPropertiesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const element = requireElement(elementRegistry, elementId);

  return jsonResult(buildElementDetail(element));
}
