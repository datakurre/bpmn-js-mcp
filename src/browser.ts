/**
 * Browser-safe BPMN tool surface. This entry point intentionally has no imports:
 * callers inject the configured modeler and optional app-owned operations.
 */

export interface BrowserModeler {
  get(service: string): unknown;
  saveXML(options?: { format?: boolean }): Promise<{ xml: string }>;
  saveSVG?(): Promise<{ svg: string }>;
}

interface BrowserBusinessObject {
  id?: string;
  name?: string;
  assignee?: string;
  candidateGroups?: string;
  candidateUsers?: string;
  asyncBefore?: boolean;
  asyncAfter?: boolean;
  default?: unknown;
  processRef?: BrowserBusinessObject;
  flowNodeRef?: BrowserBusinessObject[];
  rootElements?: BrowserBusinessObject[];
  $parent?: BrowserBusinessObject;
  $type?: string;
  script?: string;
  eventDefinitions?: BrowserBusinessObject[];
  body?: string;
  timeDate?: BrowserBusinessObject;
  timeDuration?: BrowserBusinessObject;
  timeCycle?: BrowserBusinessObject;
  condition?: BrowserBusinessObject;
  appliesTo?: string[];
  scriptFormat?: string;
  calledElement?: string;
  formKey?: string;
  type?: string;
  topic?: string;
  event?: string;
  class?: string;
  delegateExpression?: string;
  expression?: string;
  inputParameters?: BrowserBusinessObject[];
  outputParameters?: BrowserBusinessObject[];
  fields?: BrowserBusinessObject[];
  value?: string;
  resource?: string;
  definition?: BrowserBusinessObject;
  items?: BrowserBusinessObject[];
  entries?: BrowserBusinessObject[];
  label?: string;
  conditionExpression?: BrowserBusinessObject;
  sourceRef?: BrowserBusinessObject;
  targetRef?: BrowserBusinessObject;
  extensionElements?: { values?: BrowserBusinessObject[]; $parent?: BrowserBusinessObject };
  values?: BrowserBusinessObject[];
}

interface BrowserElement {
  id: string;
  type: string;
  businessObject?: BrowserBusinessObject;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parent?: BrowserElement;
  source?: { id?: string };
  target?: { id?: string };
}

export interface BrowserToolContext {
  modeler: BrowserModeler;
  templates?: unknown[];
  autoLayout?(): Promise<void>;
  validate?(): Promise<unknown[]>;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const elementTypes = new Set([
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask',
  'bpmn:ManualTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:CallActivity',
  'bpmn:SubProcess',
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
]);

const nonFlowNodeTypes = new Set([
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:LaneSet',
  'bpmn:Process',
  'bpmn:Collaboration',
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Association',
  'bpmn:TextAnnotation',
  'bpmn:Group',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
]);

const batchToolNames = [
  'create_bpmn_participant',
  'create_bpmn_collaboration',
  'create_bpmn_lanes',
  'add_bpmn_elements',
  'connect_bpmn_elements',
  'set_bpmn_element_properties',
  'apply_bpmn_element_template',
  'set_bpmn_script',
  'set_bpmn_input_output_mapping',
  'set_bpmn_form_data',
  'set_bpmn_camunda_listeners',
  'set_bpmn_event_definition',
  'move_bpmn_element',
  'delete_bpmn_element',
  'align_bpmn_elements',
  'assign_bpmn_elements_to_lane',
] as const;

const MAX_TEXT_LENGTH = 50000;
const MAX_NAME_LENGTH = 2048;

const propertyNames = new Set([
  'name',
  'assignee',
  'candidateGroups',
  'candidateUsers',
  'asyncBefore',
  'asyncAfter',
]);

export const BROWSER_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'list_bpmn_elements',
    description: 'List the BPMN elements currently in the draft diagram.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_bpmn_element_properties',
    description: 'Read the name and supported Camunda 7/Operaton properties of one BPMN element.',
    parameters: {
      type: 'object',
      properties: { elementId: { type: 'string' } },
      required: ['elementId'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_bpmn_elements',
    description:
      'Add BPMN events, tasks, activities, or gateways to the draft. Optionally connect them as a chain.',
    parameters: {
      type: 'object',
      properties: {
        elements: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              elementType: { type: 'string', enum: [...elementTypes] },
              name: { type: 'string' },
              participantId: { type: 'string' },
              laneId: { type: 'string' },
            },
            required: ['elementType'],
            additionalProperties: false,
          },
        },
        afterElementId: { type: 'string' },
        participantId: { type: 'string' },
        laneId: { type: 'string' },
        connect: { type: 'boolean', default: false },
      },
      required: ['elements'],
      additionalProperties: false,
    },
  },
  {
    name: 'connect_bpmn_elements',
    description: 'Connect two existing BPMN elements with a sequence flow.',
    parameters: {
      type: 'object',
      properties: {
        sourceElementId: { type: 'string' },
        targetElementId: { type: 'string' },
        connectionType: {
          type: 'string',
          enum: ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association'],
        },
        name: { type: 'string' },
        conditionExpression: { type: 'string' },
        isDefault: { type: 'boolean' },
        associationDirection: { type: 'string', enum: ['None', 'One', 'Both'] },
      },
      required: ['sourceElementId', 'targetElementId'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_bpmn_element_properties',
    description: 'Set a BPMN element name or supported Camunda 7/Operaton user-task properties.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string' },
        properties: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            assignee: { type: 'string' },
            candidateGroups: { type: 'string' },
            candidateUsers: { type: 'string' },
            asyncBefore: { type: 'boolean' },
            asyncAfter: { type: 'boolean' },
          },
          minProperties: 1,
          additionalProperties: false,
        },
      },
      required: ['elementId', 'properties'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_bpmn_element_templates',
    description: 'List Operaton/Camunda 7 element templates currently loaded in the draft modeler.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'apply_bpmn_element_template',
    description: 'Apply a loaded Operaton/Camunda 7 element template to a compatible BPMN element.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string' },
        templateId: { type: 'string' },
      },
      required: ['elementId', 'templateId'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_bpmn_script',
    description:
      'Set inline script or an external resource on a ScriptTask. Script content is stored, never executed by the editor.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string' },
        scriptFormat: { type: 'string' },
        script: { type: 'string' },
        resource: { type: 'string' },
        resultVariable: { type: 'string' },
      },
      required: ['elementId', 'scriptFormat'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_bpmn_input_output_mapping',
    description:
      'Set Camunda 7/Operaton input and output parameters using values, lists, maps, or scripts; empty arrays clear a direction.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string' },
        inputParameters: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              list: { type: 'array', maxItems: 40, items: { type: 'string' } },
              map: { type: 'object', additionalProperties: { type: 'string' } },
              script: {
                type: 'object',
                properties: {
                  scriptFormat: { type: 'string' },
                  value: { type: 'string' },
                  resource: { type: 'string' },
                },
                required: ['scriptFormat'],
                additionalProperties: false,
              },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        outputParameters: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              list: { type: 'array', maxItems: 40, items: { type: 'string' } },
              map: { type: 'object', additionalProperties: { type: 'string' } },
              script: {
                type: 'object',
                properties: {
                  scriptFormat: { type: 'string' },
                  value: { type: 'string' },
                  resource: { type: 'string' },
                },
                required: ['scriptFormat'],
                additionalProperties: false,
              },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
      required: ['elementId'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_bpmn_form_data',
    description: 'Set a generated Camunda 7/Operaton form on a user task or start event.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string' },
        fields: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              type: { type: 'string', enum: ['string', 'long', 'boolean', 'date', 'enum'] },
              defaultValue: { type: 'string' },
              datePattern: { type: 'string' },
              properties: { type: 'object', additionalProperties: { type: 'string' } },
              validation: {
                type: 'array',
                maxItems: 20,
                items: {
                  type: 'object',
                  properties: { name: { type: 'string' }, config: { type: 'string' } },
                  required: ['name'],
                  additionalProperties: false,
                },
              },
              values: {
                type: 'array',
                maxItems: 40,
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, name: { type: 'string' } },
                  required: ['id', 'name'],
                  additionalProperties: false,
                },
              },
            },
            required: ['id', 'label', 'type'],
            additionalProperties: false,
          },
        },
        businessKey: { type: 'string' },
      },
      required: ['elementId', 'fields'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_bpmn_camunda_listeners',
    description: 'Set Camunda 7/Operaton execution listeners, or task listeners on a user task.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string' },
        listeners: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              event: {
                type: 'string',
                enum: [
                  'start',
                  'end',
                  'create',
                  'assignment',
                  'complete',
                  'delete',
                  'update',
                  'timeout',
                ],
              },
              listenerType: { type: 'string', enum: ['class', 'delegateExpression', 'expression'] },
              value: { type: 'string' },
            },
            required: ['event', 'listenerType', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['elementId', 'listeners'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_bpmn_event_definition',
    description: 'Set a timer, conditional, or terminate definition on a BPMN event.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string' },
        eventType: { type: 'string', enum: ['timer', 'conditional', 'terminate'] },
        value: { type: 'string' },
        timerKind: { type: 'string', enum: ['date', 'duration', 'cycle'] },
      },
      required: ['elementId', 'eventType'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_bpmn_collaboration',
    description:
      'Create two or more BPMN participants in one collaboration. Later pools default to collapsed for Camunda 7 compatibility.',
    parameters: {
      type: 'object',
      properties: {
        participants: {
          type: 'array',
          minItems: 2,
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              participantId: { type: 'string' },
              processId: { type: 'string' },
              name: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              collapsed: { type: 'boolean' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
      required: ['participants'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_bpmn_participant',
    description: 'Create a pool (participant), optionally with lanes and a non-executable process.',
    parameters: {
      type: 'object',
      properties: {
        participantId: { type: 'string' },
        processId: { type: 'string' },
        name: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        collapsed: { type: 'boolean' },
        lanes: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, height: { type: 'number' } },
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_bpmn_lanes',
    description: 'Add named lanes to an existing BPMN participant.',
    parameters: {
      type: 'object',
      properties: {
        participantId: { type: 'string' },
        lanes: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, height: { type: 'number' } },
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
      required: ['participantId', 'lanes'],
      additionalProperties: false,
    },
  },
  {
    name: 'assign_bpmn_elements_to_lane',
    description: 'Assign existing flow nodes to a lane and place them within its bounds.',
    parameters: {
      type: 'object',
      properties: {
        laneId: { type: 'string' },
        elementIds: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'string' } },
      },
      required: ['laneId', 'elementIds'],
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_bpmn_lanes',
    description: 'List participant, lane, and flow-node membership for the diagram.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'move_bpmn_element',
    description: 'Move a BPMN shape by relative x/y offsets, optionally assigning it to a lane.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string' },
        dx: { type: 'number' },
        dy: { type: 'number' },
        laneId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'delete_bpmn_element',
    description: 'Remove a BPMN element from the draft diagram.',
    parameters: {
      type: 'object',
      properties: { elementId: { type: 'string' } },
      required: ['elementId'],
      additionalProperties: false,
    },
  },
  {
    name: 'align_bpmn_elements',
    description:
      'Align two or more BPMN shapes to the same left, center, right, top, middle, or bottom edge.',
    parameters: {
      type: 'object',
      properties: {
        elementIds: { type: 'array', minItems: 2, maxItems: 40, items: { type: 'string' } },
        alignment: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] },
      },
      required: ['elementIds', 'alignment'],
      additionalProperties: false,
    },
  },
  {
    name: 'layout_bpmn_diagram',
    description: 'Run the editor auto-layout operation on the draft diagram.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'validate_bpmn_diagram',
    description: 'Run BPMN validation and return any lint issues.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'export_bpmn',
    description: 'Export the current draft as BPMN XML.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'export_bpmn_svg',
    description: 'Export the current draft as SVG.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'bpmn_history',
    description: 'Undo or redo the last change in the draft diagram.',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['undo', 'redo'] } },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'batch_bpmn_operations',
    description:
      'Run up to 20 supported draft operations in order. A failure returns the completed prefix; earlier operations are not rolled back.',
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', enum: [...batchToolNames] },
              arguments: { type: 'object' },
            },
            required: ['tool', 'arguments'],
            additionalProperties: false,
          },
        },
      },
      required: ['operations'],
      additionalProperties: false,
    },
  },
];

export class BrowserToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserToolError';
  }
}

function service<T>(modeler: BrowserModeler, name: string): T {
  const result = modeler.get(name);
  if (!result) throw new BrowserToolError(`The BPMN modeler service "${name}" is unavailable.`);
  return result as T;
}

function object(value: unknown, label = 'Arguments'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BrowserToolError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function allowKeys(args: Record<string, unknown>, allowed: string[]): void {
  const unexpected = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unexpected.length)
    throw new BrowserToolError(`Unsupported argument(s): ${unexpected.join(', ')}.`);
}

function stringArg(args: Record<string, unknown>, name: string, max = MAX_NAME_LENGTH): string {
  const value = args[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BrowserToolError(`"${name}" must be a non-empty string.`);
  }
  if (value.length > max)
    throw new BrowserToolError(`"${name}" must be at most ${max} characters.`);
  return value;
}

/** Validates a BPMN id that is written into the diagram as an XML ID (NCName subset). */
function xmlIdArg(args: Record<string, unknown>, name: string): string {
  const value = stringArg(args, name);
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) {
    throw new BrowserToolError(
      `"${name}" must start with a letter or underscore and contain only letters, digits, "_", "-", or ".".`
    );
  }
  return value;
}

function boundedText(value: unknown, label: string, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new BrowserToolError(`"${label}" must be a string of at most ${max} characters.`);
  }
  return value;
}

/**
 * The participant that owns an element, or undefined for elements on the root process
 * (`rootId` is the canvas root element, which is never a container).
 */
function containerOf(element: BrowserElement, rootId: string): string | undefined {
  if (element.type === 'bpmn:Participant') return element.id;
  // Lanes are nested in their participant, so skip them to reach the owning container.
  let parent = element.parent;
  while (parent?.type === 'bpmn:Lane') parent = parent.parent;
  if (
    !parent ||
    parent.id === rootId ||
    parent.type === 'bpmn:Process' ||
    parent.type === 'bpmn:Collaboration'
  ) {
    return undefined;
  }
  return parent.id;
}

function rootIdOf(modeler: BrowserModeler): string {
  return service<{ getRootElement(): BrowserElement }>(modeler, 'canvas').getRootElement().id;
}

function isFlowNode(element: BrowserElement): boolean {
  return element.type.startsWith('bpmn:') && !nonFlowNodeTypes.has(element.type);
}

function registryElements(modeler: BrowserModeler): BrowserElement[] {
  const registry = service<{ getAll(): BrowserElement[] }>(modeler, 'elementRegistry');
  return registry
    .getAll()
    .filter(
      (element) =>
        element.type.startsWith('bpmn:') && element.x !== undefined && element.y !== undefined
    );
}

function registryBpmnElements(modeler: BrowserModeler): BrowserElement[] {
  const registry = service<{ getAll(): BrowserElement[] }>(modeler, 'elementRegistry');
  return registry.getAll().filter((element) => element.type.startsWith('bpmn:'));
}

function findBpmnElement(modeler: BrowserModeler, id: string): BrowserElement {
  const element = service<{ get(id: string): BrowserElement | undefined }>(
    modeler,
    'elementRegistry'
  ).get(id);
  if (!element || !element.type.startsWith('bpmn:')) {
    throw new BrowserToolError(`BPMN element "${id}" was not found.`);
  }
  return element;
}

function isDefaultFlow(modeler: BrowserModeler, flow: BrowserElement): boolean {
  return registryBpmnElements(modeler).some((element) => {
    const defaultFlow = element.businessObject?.default as BrowserBusinessObject | undefined;
    return defaultFlow === flow.businessObject || defaultFlow?.id === flow.id;
  });
}

function findElement(modeler: BrowserModeler, id: string): BrowserElement {
  const element = service<{ get(id: string): BrowserElement | undefined }>(
    modeler,
    'elementRegistry'
  ).get(id);
  if (!element) throw new BrowserToolError(`BPMN element "${id}" was not found.`);
  if (!element.type.startsWith('bpmn:') || element.x === undefined || element.y === undefined) {
    throw new BrowserToolError(`BPMN element "${id}" is not a supported diagram shape.`);
  }
  return element;
}

function positiveNumber(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BrowserToolError(`"${name}" must be a positive number.`);
  }
  return value;
}

function createLanes(
  modeler: BrowserModeler,
  participant: BrowserElement,
  laneSpecs: unknown[]
): BrowserElement[] {
  if (participant.type !== 'bpmn:Participant') {
    throw new BrowserToolError(`Element "${participant.id}" is not a BPMN participant.`);
  }
  if (!participant.businessObject?.processRef) {
    throw new BrowserToolError(
      `Participant "${participant.id}" must have an expanded process before lanes can be added.`
    );
  }
  if ((participant.width ?? 600) < 130) {
    throw new BrowserToolError('A participant must be at least 130 pixels wide to contain lanes.');
  }
  if (laneSpecs.length < 1 || laneSpecs.length > 12) {
    throw new BrowserToolError('"lanes" must contain between 1 and 12 items.');
  }
  const factory = service<{ createShape(attrs: Record<string, unknown>): BrowserElement }>(
    modeler,
    'elementFactory'
  );
  const modeling = service<{
    createShape(
      shape: BrowserElement,
      position: { x: number; y: number },
      parent: BrowserElement
    ): BrowserElement;
    updateProperties(element: BrowserElement, properties: Record<string, unknown>): void;
    resizeShape(
      element: BrowserElement,
      bounds: { x: number; y: number; width: number; height: number }
    ): void;
    updateModdleProperties(
      element: BrowserElement,
      moddleElement: BrowserBusinessObject,
      properties: Record<string, unknown>
    ): void;
  }>(modeler, 'modeling');
  const participantWidth = participant.width ?? 600;
  const existingLanes = registryElements(modeler).filter(
    (element) => element.type === 'bpmn:Lane' && element.parent?.id === participant.id
  );
  if (existingLanes.length) {
    throw new BrowserToolError(
      `Participant "${participant.id}" already has lanes; use a new participant.`
    );
  }
  const lanes = laneSpecs.map((rawLane, index) => {
    const lane = object(rawLane, `lanes[${index}]`);
    allowKeys(lane, ['name', 'height']);
    const name = stringArg(lane, 'name');
    const height = positiveNumber(lane.height, `lanes[${index}].height`, 120);
    return { name, height };
  });
  const totalHeight = lanes.reduce((height, lane) => height + lane.height, 0);
  const top = participant.y ?? 0;
  const left = (participant.x ?? 0) + 30;
  const width = Math.max(100, participantWidth - 30);
  const updatedHeight = Math.max(participant.height ?? 0, totalHeight);
  modeling.resizeShape(participant, { x: left, y: top, width, height: updatedHeight });

  let y = top;
  return lanes.map(({ name, height }) => {
    const laneShape = factory.createShape({ type: 'bpmn:Lane' });
    const created = modeling.createShape(
      laneShape,
      { x: left + width / 2, y: y + height / 2 },
      participant
    );
    modeling.updateProperties(created, { name });
    modeling.resizeShape(created, { x: left, y, width, height });
    y += height;
    return created;
  });
}

function assignToLane(
  modeler: BrowserModeler,
  lane: BrowserElement,
  elements: BrowserElement[]
): void {
  if (lane.type !== 'bpmn:Lane') {
    throw new BrowserToolError(`Element "${lane.id}" is not a BPMN lane.`);
  }
  const forbiddenTypes = new Set([
    'bpmn:Participant',
    'bpmn:Lane',
    'bpmn:Process',
    'bpmn:Collaboration',
    'bpmn:BoundaryEvent',
  ]);
  if (elements.some((element) => forbiddenTypes.has(element.type))) {
    throw new BrowserToolError('Only flow nodes can be assigned to a lane.');
  }
  const rootId = rootIdOf(modeler);
  const laneContainer = containerOf(lane, rootId);
  if (
    laneContainer === undefined ||
    elements.some((element) => containerOf(element, rootId) !== laneContainer)
  ) {
    throw new BrowserToolError(
      'Elements can only be assigned to a lane in the participant that already contains them.'
    );
  }
  const modeling = service<{
    moveElements(elements: BrowserElement[], delta: { x: number; y: number }): void;
    updateModdleProperties(
      element: BrowserElement,
      moddleElement: BrowserBusinessObject,
      properties: Record<string, unknown>
    ): void;
  }>(modeler, 'modeling');
  const lanes = registryElements(modeler).filter((element) => element.type === 'bpmn:Lane');
  const updates = new Map<BrowserElement, BrowserBusinessObject[]>();
  for (const element of elements) {
    const businessObject = element.businessObject;
    if (!businessObject) continue;
    for (const otherLane of lanes) {
      if (!otherLane.businessObject) continue;
      const refs = updates.get(otherLane) ?? otherLane.businessObject.flowNodeRef ?? [];
      const filtered = refs.filter(
        (member) => member !== businessObject && member.id !== businessObject.id
      );
      if (otherLane.id === lane.id) {
        if (
          !filtered.some((member) => member === businessObject || member.id === businessObject.id)
        ) {
          filtered.push(businessObject);
        }
      }
      updates.set(otherLane, filtered);
    }
    const centerY = element.y! + (element.height ?? 0) / 2;
    const laneTop = lane.y!;
    const laneBottom = laneTop + (lane.height ?? 0);
    const halfHeight = (element.height ?? 0) / 2;
    const targetY =
      centerY - halfHeight < laneTop || centerY + halfHeight > laneBottom
        ? laneTop + (lane.height ?? 0) / 2
        : centerY;
    const deltaY = targetY - centerY;
    if (Math.abs(deltaY) > 0.5) modeling.moveElements([element], { x: 0, y: deltaY });
  }
  for (const [changedLane, flowNodeRef] of updates) {
    if (changedLane.businessObject) {
      modeling.updateModdleProperties(changedLane, changedLane.businessObject, { flowNodeRef });
    }
  }
}

/**
 * Replaces every extension element of `type` on the element with `replacements`
 * through modeling commands. Other extension elements are kept as they are.
 */
function replaceExtensionElements(
  modeler: BrowserModeler,
  element: BrowserElement,
  type: string,
  replacements: BrowserBusinessObject[]
): void {
  const businessObject = element.businessObject;
  if (!businessObject)
    throw new BrowserToolError(`Element "${element.id}" has no BPMN business object.`);
  const extensionElements = businessObject.extensionElements;
  const existing = extensionElements?.values ?? [];
  if (replacements.length === 0 && !existing.some((value) => value.$type === type)) return;
  const modeling = service<{
    updateProperties(element: BrowserElement, properties: Record<string, unknown>): void;
    updateModdleProperties(
      element: BrowserElement,
      moddleElement: BrowserBusinessObject,
      properties: Record<string, unknown>
    ): void;
  }>(modeler, 'modeling');
  const values = existing.filter((value) => value.$type !== type);
  for (const replacement of replacements) {
    values.push(replacement);
  }
  if (extensionElements) {
    for (const replacement of replacements) replacement.$parent = extensionElements;
    if (values.length) modeling.updateModdleProperties(element, extensionElements, { values });
    else modeling.updateProperties(element, { extensionElements: undefined });
    return;
  }
  const moddle = service<{
    create(type: string, properties?: Record<string, unknown>): BrowserBusinessObject;
  }>(modeler, 'moddle');
  const created = moddle.create('bpmn:ExtensionElements', { values });
  created.$parent = businessObject;
  for (const replacement of replacements) replacement.$parent = created;
  modeling.updateProperties(element, { extensionElements: created });
}

function parseCamundaParameters(
  modeler: BrowserModeler,
  rawParameters: unknown,
  direction: 'Input' | 'Output'
): BrowserBusinessObject[] {
  if (rawParameters === undefined) return [];
  if (!Array.isArray(rawParameters) || rawParameters.length > 40) {
    throw new BrowserToolError(
      `"${direction.toLowerCase()}Parameters" must contain at most 40 items.`
    );
  }
  const moddle = service<{
    create(type: string, properties: Record<string, unknown>): BrowserBusinessObject;
  }>(modeler, 'moddle');
  return rawParameters.map((rawParameter, index) => {
    const parameter = object(rawParameter, `${direction.toLowerCase()}Parameters[${index}]`);
    allowKeys(parameter, ['name', 'value', 'list', 'map', 'script']);
    const name = stringArg(parameter, 'name');
    const definitions = ['value', 'list', 'map', 'script'].filter(
      (key) => parameter[key] !== undefined
    );
    if (definitions.length !== 1) {
      throw new BrowserToolError(
        `"${direction.toLowerCase()}Parameters[${index}]" must contain exactly one value, list, map, or script.`
      );
    }
    const parameterElement = moddle.create(`camunda:${direction}Parameter`, { name });
    if (parameter.value !== undefined) {
      parameterElement.value = boundedText(
        parameter.value,
        `${direction.toLowerCase()}Parameters[${index}].value`
      );
      return parameterElement;
    }
    if (parameter.list !== undefined) {
      if (!Array.isArray(parameter.list) || parameter.list.length > 40) {
        throw new BrowserToolError(
          `"${direction.toLowerCase()}Parameters[${index}].list" must contain at most 40 strings.`
        );
      }
      const items = parameter.list.map((value, valueIndex) =>
        moddle.create('camunda:Value', {
          value: boundedText(
            value,
            `${direction.toLowerCase()}Parameters[${index}].list[${valueIndex}]`
          ),
        })
      );
      const list = moddle.create('camunda:List', { items });
      for (const item of items) item.$parent = list;
      list.$parent = parameterElement;
      parameterElement.definition = list;
      return parameterElement;
    }
    if (parameter.map !== undefined) {
      const entriesObject = object(
        parameter.map,
        `${direction.toLowerCase()}Parameters[${index}].map`
      );
      const entries = Object.entries(entriesObject);
      if (entries.length > 40 || entries.some(([, value]) => typeof value !== 'string')) {
        throw new BrowserToolError(
          `"${direction.toLowerCase()}Parameters[${index}].map" must contain at most 40 string values.`
        );
      }
      const values = entries.map(([key, value]) => {
        if (!key.trim())
          throw new BrowserToolError(
            `"${direction.toLowerCase()}Parameters[${index}].map" keys must be non-empty.`
          );
        return moddle.create('camunda:Entry', {
          key,
          value: boundedText(value, `${direction.toLowerCase()}Parameters[${index}].map.${key}`),
        });
      });
      const map = moddle.create('camunda:Map', { entries: values });
      for (const entry of values) entry.$parent = map;
      map.$parent = parameterElement;
      parameterElement.definition = map;
      return parameterElement;
    }
    const script = object(
      parameter.script,
      `${direction.toLowerCase()}Parameters[${index}].script`
    );
    allowKeys(script, ['scriptFormat', 'value', 'resource']);
    const scriptFormat = stringArg(script, 'scriptFormat');
    const hasValue = script.value !== undefined;
    const hasResource = script.resource !== undefined;
    if (
      hasValue === hasResource ||
      (hasValue && (typeof script.value !== 'string' || script.value.length > 50000)) ||
      (hasResource &&
        (typeof script.resource !== 'string' ||
          script.resource.trim() === '' ||
          script.resource.length > 2048))
    ) {
      throw new BrowserToolError(
        `"${direction.toLowerCase()}Parameters[${index}].script" must specify exactly one bounded inline value or resource.`
      );
    }
    const scriptValue = moddle.create('camunda:Script', {
      scriptFormat,
      value: hasValue ? script.value : undefined,
      resource: hasResource ? script.resource : undefined,
    });
    scriptValue.$parent = parameterElement;
    parameterElement.definition = scriptValue;
    return parameterElement;
  });
}

export async function dispatchBrowserTool(
  context: BrowserToolContext,
  name: string,
  rawArgs: unknown
): Promise<unknown> {
  const args = object(rawArgs);
  const { modeler } = context;

  switch (name) {
    case 'list_bpmn_elements':
      allowKeys(args, []);
      return registryBpmnElements(modeler).map((element) => ({
        id: element.id,
        type: element.type,
        name: element.businessObject?.name ?? '',
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        parentId: element.parent?.id,
        sourceElementId: element.source?.id ?? element.businessObject?.sourceRef?.id,
        targetElementId: element.target?.id ?? element.businessObject?.targetRef?.id,
      }));

    case 'list_bpmn_element_templates': {
      allowKeys(args, []);
      const templates = context.templates;
      if (!templates)
        throw new BrowserToolError('Element templates are unavailable in this browser build.');
      const templateService = service<{
        getLatest(id: string): BrowserBusinessObject[];
        isCompatible(template: BrowserBusinessObject): boolean;
      }>(modeler, 'elementTemplates');
      return templates.flatMap((rawTemplate, index) => {
        const template = object(rawTemplate, `templates[${index}]`);
        if (typeof template.id !== 'string' || typeof template.name !== 'string') return [];
        const latest = templateService.getLatest(template.id)[0];
        if (!latest || !templateService.isCompatible(latest)) return [];
        return [
          {
            id: template.id,
            name: template.name,
            description: typeof template.description === 'string' ? template.description : '',
            appliesTo: Array.isArray(template.appliesTo) ? template.appliesTo : [],
          },
        ];
      });
    }

    case 'apply_bpmn_element_template': {
      allowKeys(args, ['elementId', 'templateId']);
      if (!context.templates)
        throw new BrowserToolError('Element templates are unavailable in this browser build.');
      const element = findElement(modeler, stringArg(args, 'elementId'));
      const templateId = stringArg(args, 'templateId');
      const templateService = service<{
        getLatest(id: string): BrowserBusinessObject[];
        isCompatible(template: BrowserBusinessObject): boolean;
        applyTemplate(element: BrowserElement, template: BrowserBusinessObject): unknown;
      }>(modeler, 'elementTemplates');
      const template = templateService.getLatest(templateId)[0];
      if (!template)
        throw new BrowserToolError(`Element template "${templateId}" is not loaded or valid.`);
      if (!templateService.isCompatible(template)) {
        throw new BrowserToolError(
          `Element template "${templateId}" is not compatible with this modeler.`
        );
      }
      const appliesTo = template.appliesTo;
      const moddle = service<{ hasType(element: BrowserBusinessObject, type: string): boolean }>(
        modeler,
        'moddle'
      );
      const businessObject = element.businessObject;
      if (!businessObject)
        throw new BrowserToolError(`Element "${element.id}" has no BPMN business object.`);
      if (
        !Array.isArray(appliesTo) ||
        !appliesTo.some((type) => moddle.hasType(businessObject, type))
      ) {
        throw new BrowserToolError(
          `Element template "${templateId}" does not apply to ${element.type}.`
        );
      }
      templateService.applyTemplate(element, template);
      return { elementId: element.id, templateId };
    }

    case 'set_bpmn_script': {
      allowKeys(args, ['elementId', 'scriptFormat', 'script', 'resource', 'resultVariable']);
      const element = findElement(modeler, stringArg(args, 'elementId'));
      if (element.type !== 'bpmn:ScriptTask') {
        throw new BrowserToolError('Scripts can only be set on BPMN ScriptTasks.');
      }
      const scriptFormat = stringArg(args, 'scriptFormat');
      const hasScript = args.script !== undefined;
      const hasResource = args.resource !== undefined;
      if (hasScript === hasResource) {
        throw new BrowserToolError('Provide exactly one of "script" or "resource".');
      }
      if (
        (hasScript && (typeof args.script !== 'string' || args.script.length > 50000)) ||
        (hasResource &&
          (typeof args.resource !== 'string' ||
            args.resource.trim() === '' ||
            args.resource.length > 2048))
      ) {
        throw new BrowserToolError(
          '"script" must be text up to 50000 characters or "resource" a non-empty path up to 2048 characters.'
        );
      }
      if (
        args.resultVariable !== undefined &&
        (typeof args.resultVariable !== 'string' || args.resultVariable.length > 255)
      ) {
        throw new BrowserToolError('"resultVariable" must be a string up to 255 characters.');
      }
      const modeling = service<{
        updateProperties(element: BrowserElement, properties: Record<string, unknown>): void;
        updateModdleProperties(
          element: BrowserElement,
          moddleElement: BrowserBusinessObject,
          properties: Record<string, unknown>
        ): void;
      }>(modeler, 'modeling');
      if (!element.businessObject)
        throw new BrowserToolError(`Element "${element.id}" has no BPMN business object.`);
      modeling.updateProperties(element, {
        scriptFormat,
        'camunda:resource': hasResource ? args.resource : undefined,
        'camunda:resultVariable': args.resultVariable || undefined,
      });
      modeling.updateModdleProperties(element, element.businessObject, {
        script: hasScript ? args.script : undefined,
      });
      return { elementId: element.id, scriptFormat, inline: hasScript };
    }

    case 'set_bpmn_input_output_mapping': {
      allowKeys(args, ['elementId', 'inputParameters', 'outputParameters']);
      const element = findElement(modeler, stringArg(args, 'elementId'));
      if (args.inputParameters === undefined && args.outputParameters === undefined) {
        throw new BrowserToolError(
          'Provide inputParameters or outputParameters; empty arrays clear existing mappings.'
        );
      }
      // A direction that is omitted keeps its existing mappings; an empty array clears it.
      const existingInputOutput = element.businessObject?.extensionElements?.values?.find(
        (value) => value.$type === 'camunda:InputOutput'
      );
      const inputParameters =
        args.inputParameters === undefined
          ? (existingInputOutput?.inputParameters ?? [])
          : parseCamundaParameters(modeler, args.inputParameters, 'Input');
      const outputParameters =
        args.outputParameters === undefined
          ? (existingInputOutput?.outputParameters ?? [])
          : parseCamundaParameters(modeler, args.outputParameters, 'Output');
      if (inputParameters.length + outputParameters.length === 0) {
        replaceExtensionElements(modeler, element, 'camunda:InputOutput', []);
        return {
          elementId: element.id,
          inputParameterCount: 0,
          outputParameterCount: 0,
          cleared: true,
        };
      }
      const moddle = service<{
        create(type: string, properties: Record<string, unknown>): BrowserBusinessObject;
      }>(modeler, 'moddle');
      const properties: Record<string, unknown> = {};
      if (inputParameters.length) properties.inputParameters = inputParameters;
      if (outputParameters.length) properties.outputParameters = outputParameters;
      const inputOutput = moddle.create('camunda:InputOutput', properties);
      for (const parameter of [...inputParameters, ...outputParameters])
        parameter.$parent = inputOutput;
      replaceExtensionElements(modeler, element, 'camunda:InputOutput', [inputOutput]);
      return {
        elementId: element.id,
        inputParameterCount: inputParameters.length,
        outputParameterCount: outputParameters.length,
      };
    }

    case 'set_bpmn_form_data': {
      allowKeys(args, ['elementId', 'fields', 'businessKey']);
      const element = findElement(modeler, stringArg(args, 'elementId'));
      if (element.type !== 'bpmn:UserTask' && element.type !== 'bpmn:StartEvent') {
        throw new BrowserToolError(
          'Generated form data is supported only on BPMN UserTasks and StartEvents.'
        );
      }
      if (!Array.isArray(args.fields) || args.fields.length < 1 || args.fields.length > 40) {
        throw new BrowserToolError('"fields" must contain between 1 and 40 form fields.');
      }
      if (args.businessKey !== undefined && typeof args.businessKey !== 'string') {
        throw new BrowserToolError('"businessKey" must be a string.');
      }
      const moddle = service<{
        create(type: string, properties?: Record<string, unknown>): BrowserBusinessObject;
      }>(modeler, 'moddle');
      const fieldIds = new Set<string>();
      const fields = args.fields.map((rawField, index) => {
        const field = object(rawField, `fields[${index}]`);
        allowKeys(field, [
          'id',
          'label',
          'type',
          'defaultValue',
          'datePattern',
          'properties',
          'validation',
          'values',
        ]);
        const id = stringArg(field, 'id');
        const label = stringArg(field, 'label');
        const fieldType = stringArg(field, 'type');
        if (!['string', 'long', 'boolean', 'date', 'enum'].includes(fieldType)) {
          throw new BrowserToolError(`Unsupported form field type "${fieldType}".`);
        }
        for (const property of ['defaultValue', 'datePattern'] as const) {
          if (field[property] !== undefined && typeof field[property] !== 'string') {
            throw new BrowserToolError(`"fields[${index}].${property}" must be a string.`);
          }
        }
        if (field.datePattern !== undefined && fieldType !== 'date') {
          throw new BrowserToolError(`"datePattern" is only valid for date field "${id}".`);
        }
        if (fieldIds.has(id)) throw new BrowserToolError(`Form field id "${id}" is repeated.`);
        fieldIds.add(id);
        const attributes: Record<string, unknown> = { id, label, type: fieldType };
        if (field.defaultValue !== undefined) attributes.defaultValue = field.defaultValue;
        if (field.datePattern !== undefined) attributes.datePattern = field.datePattern;
        if (field.properties !== undefined) {
          const fieldProperties = object(field.properties, `fields[${index}].properties`);
          const entries = Object.entries(fieldProperties);
          if (entries.length > 40 || entries.some(([, value]) => typeof value !== 'string')) {
            throw new BrowserToolError(
              `"fields[${index}].properties" must contain at most 40 string values.`
            );
          }
          if (entries.length) {
            const values = entries.map(([propertyId, value]) =>
              moddle.create('camunda:Property', { id: propertyId, value })
            );
            const properties = moddle.create('camunda:Properties', { values });
            for (const property of values) property.$parent = properties;
            attributes.properties = properties;
          }
        }
        if (field.validation !== undefined) {
          if (!Array.isArray(field.validation) || field.validation.length > 20) {
            throw new BrowserToolError(
              `"fields[${index}].validation" must contain at most 20 constraints.`
            );
          }
          const constraints = field.validation.map((rawConstraint, constraintIndex) => {
            const constraint = object(
              rawConstraint,
              `fields[${index}].validation[${constraintIndex}]`
            );
            allowKeys(constraint, ['name', 'config']);
            const constraintName = stringArg(constraint, 'name');
            if (constraint.config !== undefined && typeof constraint.config !== 'string') {
              throw new BrowserToolError(
                `"fields[${index}].validation[${constraintIndex}].config" must be a string.`
              );
            }
            const constraintProperties: Record<string, unknown> = { name: constraintName };
            if (constraint.config !== undefined) constraintProperties.config = constraint.config;
            return moddle.create('camunda:Constraint', constraintProperties);
          });
          if (constraints.length) {
            const validation = moddle.create('camunda:Validation', { constraints });
            for (const constraint of constraints) constraint.$parent = validation;
            attributes.validation = validation;
          }
        }
        if (field.values !== undefined) {
          if (!Array.isArray(field.values) || field.values.length > 40) {
            throw new BrowserToolError(`"fields[${index}].values" must contain at most 40 items.`);
          }
          if (fieldType !== 'enum' && field.values.length) {
            throw new BrowserToolError(`Enum values are only valid for enum field "${id}".`);
          }
          attributes.values = field.values.map((rawValue, valueIndex) => {
            const value = object(rawValue, `fields[${index}].values[${valueIndex}]`);
            allowKeys(value, ['id', 'name']);
            return moddle.create('camunda:Value', {
              id: stringArg(value, 'id'),
              name: stringArg(value, 'name'),
            });
          });
        }
        if (fieldType === 'enum' && (!Array.isArray(field.values) || field.values.length === 0)) {
          throw new BrowserToolError(`Enum field "${id}" must include at least one value.`);
        }
        const created = moddle.create('camunda:FormField', attributes);
        for (const value of (attributes.values as BrowserBusinessObject[] | undefined) ?? []) {
          value.$parent = created;
        }
        if (attributes.properties && typeof attributes.properties === 'object') {
          (attributes.properties as BrowserBusinessObject).$parent = created;
        }
        if (attributes.validation && typeof attributes.validation === 'object') {
          (attributes.validation as BrowserBusinessObject).$parent = created;
        }
        return created;
      });
      const formData = moddle.create('camunda:FormData', {
        fields,
        businessKey: args.businessKey || undefined,
      });
      for (const field of fields) field.$parent = formData;
      replaceExtensionElements(modeler, element, 'camunda:FormData', [formData]);
      return { elementId: element.id, fieldCount: fields.length };
    }

    case 'set_bpmn_camunda_listeners': {
      allowKeys(args, ['elementId', 'listeners']);
      const element = findElement(modeler, stringArg(args, 'elementId'));
      if (!Array.isArray(args.listeners) || args.listeners.length > 20) {
        throw new BrowserToolError('"listeners" must contain at most 20 items.');
      }
      const isTaskListener = element.type === 'bpmn:UserTask';
      const type = isTaskListener ? 'camunda:TaskListener' : 'camunda:ExecutionListener';
      const moddle = service<{
        create(type: string, properties: Record<string, unknown>): BrowserBusinessObject;
      }>(modeler, 'moddle');
      const listeners = args.listeners.map((rawListener, index) => {
        const listener = object(rawListener, `listeners[${index}]`);
        allowKeys(listener, ['event', 'listenerType', 'value']);
        const event = stringArg(listener, 'event');
        const listenerType = stringArg(listener, 'listenerType');
        const value = stringArg(listener, 'value', MAX_TEXT_LENGTH);
        const taskEvents = ['create', 'assignment', 'complete', 'delete', 'update', 'timeout'];
        const executionEvents = ['start', 'end'];
        if (isTaskListener ? !taskEvents.includes(event) : !executionEvents.includes(event)) {
          throw new BrowserToolError(
            `Event "${event}" is not supported for this ${isTaskListener ? 'task' : 'execution'} listener target.`
          );
        }
        if (!['class', 'delegateExpression', 'expression'].includes(listenerType)) {
          throw new BrowserToolError(`Unsupported listener type "${listenerType}".`);
        }
        return moddle.create(type, { event, [listenerType]: value });
      });
      replaceExtensionElements(modeler, element, type, listeners);
      return { elementId: element.id, listenerCount: listeners.length };
    }

    case 'set_bpmn_event_definition': {
      allowKeys(args, ['elementId', 'eventType', 'value', 'timerKind']);
      const element = findElement(modeler, stringArg(args, 'elementId'));
      if (!element.type.endsWith('Event') && element.type !== 'bpmn:BoundaryEvent') {
        throw new BrowserToolError('Event definitions can only be set on BPMN events.');
      }
      const eventType = stringArg(args, 'eventType');
      const typeByName: Record<string, string> = {
        timer: 'bpmn:TimerEventDefinition',
        conditional: 'bpmn:ConditionalEventDefinition',
        terminate: 'bpmn:TerminateEventDefinition',
      };
      const type = typeByName[eventType];
      if (!type) throw new BrowserToolError(`Unsupported event definition type "${eventType}".`);
      const validEventTypes =
        eventType === 'terminate'
          ? ['bpmn:EndEvent']
          : ['bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'];
      if (!validEventTypes.includes(element.type)) {
        throw new BrowserToolError(
          `${eventType} event definitions are not supported on ${element.type}.`
        );
      }
      const moddle = service<{
        create(type: string, properties?: Record<string, unknown>): BrowserBusinessObject;
      }>(modeler, 'moddle');
      const definitionProperties: Record<string, unknown> = {};
      if (eventType === 'conditional' && args.timerKind !== undefined) {
        throw new BrowserToolError('"timerKind" is only valid for timer definitions.');
      }
      if (eventType === 'timer' || eventType === 'conditional') {
        const value = stringArg(args, 'value', MAX_TEXT_LENGTH);
        const expression = moddle.create('bpmn:FormalExpression', { body: value });
        if (eventType === 'conditional') {
          definitionProperties.condition = expression;
        } else {
          const timerKind = stringArg(args, 'timerKind');
          const timerProperty =
            timerKind === 'date'
              ? 'timeDate'
              : timerKind === 'duration'
                ? 'timeDuration'
                : timerKind === 'cycle'
                  ? 'timeCycle'
                  : undefined;
          if (!timerProperty)
            throw new BrowserToolError('"timerKind" must be date, duration, or cycle.');
          definitionProperties[timerProperty] = expression;
        }
      } else if (args.value !== undefined || args.timerKind !== undefined) {
        throw new BrowserToolError(
          'The terminate event definition does not accept a value or timerKind.'
        );
      }
      const definition = moddle.create(type, definitionProperties);
      for (const value of Object.values(definitionProperties)) {
        if (value && typeof value === 'object')
          (value as BrowserBusinessObject).$parent = definition;
      }
      const businessObject = element.businessObject;
      if (!businessObject)
        throw new BrowserToolError(`Element "${element.id}" has no BPMN business object.`);
      const replacedTypes = new Set(Object.values(typeByName));
      const eventDefinitions = (businessObject.eventDefinitions ?? []).filter(
        (existing) => !replacedTypes.has(existing.$type ?? '')
      );
      definition.$parent = businessObject;
      eventDefinitions.push(definition);
      service<{
        updateModdleProperties(
          element: BrowserElement,
          moddleElement: BrowserBusinessObject,
          properties: Record<string, unknown>
        ): void;
      }>(modeler, 'modeling').updateModdleProperties(element, businessObject, { eventDefinitions });
      return { elementId: element.id, eventType };
    }

    case 'create_bpmn_collaboration': {
      allowKeys(args, ['participants']);
      if (
        !Array.isArray(args.participants) ||
        args.participants.length < 2 ||
        args.participants.length > 12
      ) {
        throw new BrowserToolError('"participants" must contain between 2 and 12 items.');
      }
      const seenIds = new Set<string>();
      const seenProcessIds = new Set<string>();
      const participants = args.participants.map((rawParticipant, index) => {
        const participant = object(rawParticipant, `participants[${index}]`);
        allowKeys(participant, [
          'participantId',
          'processId',
          'name',
          'x',
          'y',
          'width',
          'height',
          'collapsed',
        ]);
        stringArg(participant, 'name');
        if (participant.participantId !== undefined) {
          const id = xmlIdArg(participant, 'participantId');
          if (
            seenIds.has(id) ||
            service<{ get(id: string): BrowserElement | undefined }>(
              modeler,
              'elementRegistry'
            ).get(id)
          ) {
            throw new BrowserToolError(`A BPMN element with ID "${id}" already exists.`);
          }
          seenIds.add(id);
        }
        if (participant.processId !== undefined) {
          const processId = xmlIdArg(participant, 'processId');
          if (seenProcessIds.has(processId)) {
            throw new BrowserToolError(
              `Process ID "${processId}" is repeated in the collaboration request.`
            );
          }
          seenProcessIds.add(processId);
        }
        for (const coordinate of ['x', 'y'] as const) {
          if (
            participant[coordinate] !== undefined &&
            (typeof participant[coordinate] !== 'number' ||
              !Number.isFinite(participant[coordinate]))
          ) {
            throw new BrowserToolError(
              `"participants[${index}].${coordinate}" must be a finite number.`
            );
          }
        }
        for (const dimension of ['width', 'height'] as const) {
          if (participant[dimension] !== undefined)
            positiveNumber(participant[dimension], `participants[${index}].${dimension}`, 1);
        }
        if (participant.collapsed !== undefined && typeof participant.collapsed !== 'boolean') {
          throw new BrowserToolError(`"participants[${index}].collapsed" must be a boolean.`);
        }
        return participant;
      });
      const created: unknown[] = [];
      const canvas = service<{ getRootElement(): BrowserElement }>(modeler, 'canvas');
      const root = canvas.getRootElement();
      const definitions = root.businessObject?.$parent;
      const existingParticipants = registryElements(modeler).filter(
        (element) => element.type === 'bpmn:Participant'
      );
      for (const [index, participant] of participants.entries()) {
        const processId = participant.processId;
        if (
          processId &&
          definitions?.rootElements?.some((rootElement) => rootElement.id === processId)
        ) {
          const reusesCurrentRoot =
            index === 0 &&
            existingParticipants.length === 0 &&
            root.businessObject?.id === processId;
          if (!reusesCurrentRoot) {
            throw new BrowserToolError(
              `A BPMN root element with ID "${processId}" already exists.`
            );
          }
        }
        if (processId && participant.collapsed === true) {
          throw new BrowserToolError(
            `Collapsed participant "${participant.name}" cannot have a processId.`
          );
        }
      }
      for (const [index, participant] of participants.entries()) {
        created.push(
          await dispatchBrowserTool(context, 'create_bpmn_participant', {
            ...participant,
            x: participant.x ?? 120,
            y: participant.y ?? 120 + index * 300,
            // Later pools collapse by default, unless they own a process (collapsed pools cannot).
            collapsed: participant.collapsed ?? (index > 0 && participant.processId === undefined),
          })
        );
      }
      return { participants: created };
    }

    case 'create_bpmn_participant': {
      allowKeys(args, [
        'participantId',
        'processId',
        'name',
        'x',
        'y',
        'width',
        'height',
        'collapsed',
        'lanes',
      ]);
      if (args.lanes !== undefined && !Array.isArray(args.lanes)) {
        throw new BrowserToolError('"lanes" must be an array.');
      }
      if (Array.isArray(args.lanes) && (args.lanes.length < 1 || args.lanes.length > 12)) {
        throw new BrowserToolError('"lanes" must contain between 1 and 12 items.');
      }
      if (Array.isArray(args.lanes)) {
        args.lanes.forEach((rawLane, index) => {
          const lane = object(rawLane, `lanes[${index}]`);
          allowKeys(lane, ['name', 'height']);
          stringArg(lane, 'name');
          positiveNumber(lane.height, `lanes[${index}].height`, 120);
        });
      }
      const x = args.x === undefined ? 120 : args.x;
      const y = args.y === undefined ? 120 : args.y;
      if (
        typeof x !== 'number' ||
        !Number.isFinite(x) ||
        typeof y !== 'number' ||
        !Number.isFinite(y)
      ) {
        throw new BrowserToolError('"x" and "y" must be finite numbers.');
      }
      const width = positiveNumber(args.width, 'width', 600);
      const height = positiveNumber(args.height, 'height', 240);
      if (Array.isArray(args.lanes) && width < 130) {
        throw new BrowserToolError(
          'A participant must be at least 130 pixels wide to contain lanes.'
        );
      }
      if (args.collapsed !== undefined && typeof args.collapsed !== 'boolean') {
        throw new BrowserToolError('"collapsed" must be a boolean.');
      }
      if (args.collapsed === true && args.lanes !== undefined) {
        throw new BrowserToolError('Collapsed participants cannot contain lanes.');
      }
      if (args.name !== undefined && typeof args.name !== 'string') {
        throw new BrowserToolError('"name" must be a string.');
      }
      if (args.processId !== undefined) xmlIdArg(args, 'processId');
      if (args.collapsed === true && args.processId !== undefined) {
        throw new BrowserToolError('Collapsed participants cannot have a processId.');
      }
      if (args.participantId !== undefined) {
        const participantId = xmlIdArg(args, 'participantId');
        if (
          service<{ get(id: string): BrowserElement | undefined }>(modeler, 'elementRegistry').get(
            participantId
          )
        ) {
          throw new BrowserToolError(`A BPMN element with ID "${participantId}" already exists.`);
        }
      }
      const canvas = service<{ getRootElement(): BrowserElement }>(modeler, 'canvas');
      const rootElement = canvas.getRootElement();
      const definitions = rootElement.businessObject?.$parent;
      const existingParticipants = registryElements(modeler).filter(
        (element) => element.type === 'bpmn:Participant'
      );
      const processId = typeof args.processId === 'string' ? args.processId : undefined;
      if (
        processId &&
        definitions?.rootElements?.some((rootElement) => rootElement.id === processId)
      ) {
        const reusesExistingRootProcess =
          existingParticipants.length === 0 && rootElement.businessObject?.id === processId;
        if (!reusesExistingRootProcess) {
          throw new BrowserToolError(`A BPMN root element with ID "${processId}" already exists.`);
        }
      }
      if (args.collapsed !== true && !definitions) {
        throw new BrowserToolError(
          'The BPMN definitions are unavailable for creating the participant process.'
        );
      }
      const factory = service<{ createShape(attrs: Record<string, unknown>): BrowserElement }>(
        modeler,
        'elementFactory'
      );
      const bpmnFactory = service<{
        create(type: string, properties: Record<string, unknown>): BrowserBusinessObject;
      }>(modeler, 'bpmnFactory');
      const modeling = service<{
        createShape(
          shape: BrowserElement,
          position: { x: number; y: number },
          parent: BrowserElement
        ): BrowserElement;
        updateProperties(element: BrowserElement, properties: Record<string, unknown>): void;
        resizeShape(
          element: BrowserElement,
          bounds: { x: number; y: number; width: number; height: number }
        ): void;
        updateModdleProperties(
          element: BrowserElement,
          moddleElement: BrowserBusinessObject,
          properties: Record<string, unknown>
        ): void;
      }>(modeler, 'modeling');
      const businessObject =
        args.participantId === undefined
          ? undefined
          : bpmnFactory.create('bpmn:Participant', { id: args.participantId });
      const shape = factory.createShape({
        type: 'bpmn:Participant',
        id: args.participantId,
        businessObject,
        isExpanded: args.collapsed !== true,
      });
      const participant = modeling.createShape(
        shape,
        { x: x + width / 2, y: y + height / 2 },
        canvas.getRootElement()
      );
      modeling.resizeShape(participant, { x, y, width, height });
      if (typeof args.name === 'string' && args.name)
        modeling.updateProperties(participant, { name: args.name });
      if (args.collapsed !== true && !participant.businessObject?.processRef) {
        const moddle = service<{
          create(type: string, properties: Record<string, unknown>): BrowserBusinessObject;
        }>(modeler, 'moddle');
        const definitions = canvas.getRootElement().businessObject?.$parent;
        if (!definitions)
          throw new BrowserToolError(
            'The BPMN definitions are unavailable for creating the participant process.'
          );
        const ids = service<{ nextPrefixed(prefix: string): string }>(modeler, 'ids');
        const process = moddle.create('bpmn:Process', {
          id: processId ?? ids.nextPrefixed('Process_'),
          isExecutable: false,
        });
        process.$parent = definitions;
        const rootElements = [...(definitions.rootElements ?? []), process];
        modeling.updateModdleProperties(participant, definitions, { rootElements });
        modeling.updateProperties(participant, { processRef: process });
      }
      if (
        processId &&
        participant.businessObject?.processRef &&
        participant.businessObject.processRef.id !== processId
      ) {
        service<{
          updateModdleProperties(
            element: BrowserElement,
            moddleElement: BrowserBusinessObject,
            properties: Record<string, unknown>
          ): void;
        }>(modeler, 'modeling').updateModdleProperties(
          participant,
          participant.businessObject.processRef,
          { id: processId }
        );
      }
      const lanes = Array.isArray(args.lanes) ? createLanes(modeler, participant, args.lanes) : [];
      return { participantId: participant.id, laneIds: lanes.map((lane) => lane.id) };
    }

    case 'create_bpmn_lanes': {
      allowKeys(args, ['participantId', 'lanes']);
      if (!Array.isArray(args.lanes)) throw new BrowserToolError('"lanes" must be an array.');
      const participant = findElement(modeler, stringArg(args, 'participantId'));
      return { laneIds: createLanes(modeler, participant, args.lanes).map((lane) => lane.id) };
    }

    case 'assign_bpmn_elements_to_lane': {
      allowKeys(args, ['laneId', 'elementIds']);
      if (
        !Array.isArray(args.elementIds) ||
        args.elementIds.length < 1 ||
        args.elementIds.length > 40
      ) {
        throw new BrowserToolError('"elementIds" must contain between 1 and 40 IDs.');
      }
      const lane = findElement(modeler, stringArg(args, 'laneId'));
      const elements = args.elementIds.map((id, index) => {
        if (typeof id !== 'string' || !id.trim()) {
          throw new BrowserToolError(`"elementIds[${index}]" must be a non-empty string.`);
        }
        return findElement(modeler, id);
      });
      assignToLane(modeler, lane, elements);
      return { laneId: lane.id, elementIds: elements.map((element) => element.id) };
    }

    case 'analyze_bpmn_lanes': {
      allowKeys(args, []);
      const elements = registryElements(modeler);
      const participants = elements.filter((element) => element.type === 'bpmn:Participant');
      return participants.map((participant) => ({
        participantId: participant.id,
        name: participant.businessObject?.name ?? '',
        lanes: elements
          .filter(
            (element) => element.type === 'bpmn:Lane' && element.parent?.id === participant.id
          )
          .map((lane) => ({
            laneId: lane.id,
            name: lane.businessObject?.name ?? '',
            elementIds:
              lane.businessObject?.flowNodeRef
                ?.map((flowNode) => flowNode.id)
                .filter((id): id is string => typeof id === 'string') ?? [],
          })),
      }));
    }

    case 'get_bpmn_element_properties': {
      allowKeys(args, ['elementId']);
      const element = findBpmnElement(modeler, stringArg(args, 'elementId'));
      const businessObject = element.businessObject;
      const extensionElements = businessObject?.extensionElements?.values ?? [];
      return {
        id: element.id,
        type: element.type,
        properties: {
          name: businessObject?.name,
          assignee: businessObject?.assignee,
          candidateGroups: businessObject?.candidateGroups,
          candidateUsers: businessObject?.candidateUsers,
          asyncBefore: businessObject?.asyncBefore,
          asyncAfter: businessObject?.asyncAfter,
          scriptFormat: businessObject?.scriptFormat,
          script: businessObject?.script,
          calledElement: businessObject?.calledElement,
          formKey: businessObject?.formKey,
          typeAttribute: businessObject?.type,
          topic: businessObject?.topic,
          conditionExpression: businessObject?.conditionExpression?.body,
          isDefaultFlow: isDefaultFlow(modeler, element),
          eventDefinitions:
            businessObject?.eventDefinitions?.map((event) => ({
              type: event.$type,
              value:
                event.timeDate?.body ??
                event.timeDuration?.body ??
                event.timeCycle?.body ??
                event.condition?.body,
            })) ?? [],
          extensions: extensionElements.map((extension) => ({
            type: extension.$type,
            event: extension.event,
            class: extension.class,
            delegateExpression: extension.delegateExpression,
            expression: extension.expression,
            inputParameters: extension.inputParameters?.map((parameter) => ({
              name: parameter.name,
              value: parameter.value,
            })),
            outputParameters: extension.outputParameters?.map((parameter) => ({
              name: parameter.name,
              value: parameter.value,
            })),
            fields: extension.fields?.map((field) => ({
              id: field.id,
              name: field.name,
              type: field.type,
              label: field.label,
              value: field.value,
            })),
          })),
        },
        parentId: element.parent?.id,
      };
    }

    case 'add_bpmn_elements': {
      allowKeys(args, ['elements', 'afterElementId', 'participantId', 'laneId', 'connect']);
      const items = args.elements;
      if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
        throw new BrowserToolError('"elements" must contain between 1 and 20 items.');
      }
      if (args.connect !== undefined && typeof args.connect !== 'boolean') {
        throw new BrowserToolError('"connect" must be a boolean.');
      }
      const chained = args.connect === true;
      const rootId = rootIdOf(modeler);
      const canvas = service<{ getRootElement(): BrowserElement }>(modeler, 'canvas');
      const startingElement =
        args.afterElementId === undefined
          ? undefined
          : findElement(modeler, stringArg(args, 'afterElementId'));
      if (startingElement && !isFlowNode(startingElement)) {
        throw new BrowserToolError(
          `"afterElementId" must reference a flow node, not ${startingElement.type}.`
        );
      }
      // Validate every item before creating anything, so a rejected request leaves the draft unchanged.
      const plans = items.map((rawItem, index) => {
        const item = object(rawItem, `elements[${index}]`);
        allowKeys(item, ['elementType', 'name', 'participantId', 'laneId']);
        const type = stringArg(item, 'elementType');
        if (!elementTypes.has(type))
          throw new BrowserToolError(`Unsupported BPMN element type "${type}".`);
        if (item.name !== undefined && typeof item.name !== 'string') {
          throw new BrowserToolError(`"elements[${index}].name" must be a string.`);
        }
        const participantId = item.participantId ?? args.participantId;
        const laneId = item.laneId ?? args.laneId;
        if (participantId !== undefined && laneId !== undefined) {
          throw new BrowserToolError('Specify either a participantId or laneId, not both.');
        }
        const parent =
          laneId !== undefined
            ? findElement(modeler, stringArg({ laneId }, 'laneId'))
            : participantId !== undefined
              ? findElement(modeler, stringArg({ participantId }, 'participantId'))
              : canvas.getRootElement();
        if (laneId !== undefined && parent.type !== 'bpmn:Lane') {
          throw new BrowserToolError(`Element "${parent.id}" is not a BPMN lane.`);
        }
        if (participantId !== undefined && parent.type !== 'bpmn:Participant') {
          throw new BrowserToolError(`Element "${parent.id}" is not a BPMN participant.`);
        }
        return { type, name: item.name, parent, container: containerOf(parent, rootId) };
      });
      if (chained) {
        let previousContainer = startingElement ? containerOf(startingElement, rootId) : undefined;
        plans.forEach((plan, index) => {
          if (index > 0 || startingElement) {
            if (previousContainer !== plan.container) {
              throw new BrowserToolError(
                'Sequence-flow chains must stay in the same BPMN container.'
              );
            }
          }
          previousContainer = plan.container;
        });
      }
      const elements = registryElements(modeler);
      const flowNodes = elements.filter(isFlowNode);
      const firstX = startingElement
        ? startingElement.x! + (startingElement.width ?? 100) + 120
        : Math.max(180, ...flowNodes.map((element) => element.x! + (element.width ?? 100) + 120));
      let x = firstX;
      let y = startingElement?.y ?? elements[0]?.y ?? 180;
      const modeling = service<{
        createShape(
          shape: { type: string },
          position: { x: number; y: number },
          parent: BrowserElement
        ): BrowserElement;
        updateProperties(element: BrowserElement, properties: Record<string, unknown>): void;
        connect(
          source: BrowserElement,
          target: BrowserElement,
          attrs: { type: string }
        ): BrowserElement;
      }>(modeler, 'modeling');
      const created: BrowserElement[] = [];
      let previous = startingElement;
      for (const [index, plan] of plans.entries()) {
        const shape = modeling.createShape({ type: plan.type }, { x, y }, plan.parent);
        if (plan.name) modeling.updateProperties(shape, { name: plan.name });
        if (chained && previous) modeling.connect(previous, shape, { type: 'bpmn:SequenceFlow' });
        created.push(shape);
        previous = shape;
        x += (shape.width ?? 100) + 120;
        if (index % 4 === 3) {
          x = firstX;
          y += 140;
        }
      }
      return { created: created.map(({ id, type }) => ({ id, type })) };
    }

    case 'connect_bpmn_elements': {
      allowKeys(args, [
        'sourceElementId',
        'targetElementId',
        'connectionType',
        'name',
        'conditionExpression',
        'isDefault',
        'associationDirection',
      ]);
      const source = findElement(modeler, stringArg(args, 'sourceElementId'));
      const target = findElement(modeler, stringArg(args, 'targetElementId'));
      if (source.id === target.id)
        throw new BrowserToolError('An element cannot be connected to itself.');
      const connectionType =
        args.connectionType === undefined ? 'bpmn:SequenceFlow' : args.connectionType;
      if (
        typeof connectionType !== 'string' ||
        !['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association'].includes(connectionType)
      ) {
        throw new BrowserToolError('Unsupported BPMN connection type.');
      }
      if (connectionType === 'bpmn:SequenceFlow' && !(isFlowNode(source) && isFlowNode(target))) {
        throw new BrowserToolError(
          'Sequence flows must connect flow nodes such as events, tasks, and gateways.'
        );
      }
      if (args.name !== undefined && typeof args.name !== 'string') {
        throw new BrowserToolError('"name" must be a string.');
      }
      if (args.conditionExpression !== undefined)
        boundedText(args.conditionExpression, 'conditionExpression');
      if (args.isDefault !== undefined && typeof args.isDefault !== 'boolean') {
        throw new BrowserToolError('"isDefault" must be a boolean.');
      }
      if (
        connectionType === 'bpmn:SequenceFlow' &&
        source.businessObject?.$parent !== target.businessObject?.$parent
      ) {
        throw new BrowserToolError(
          'Sequence flows must connect flow nodes in the same BPMN process.'
        );
      }
      if (
        connectionType === 'bpmn:MessageFlow' &&
        source.businessObject?.$parent === target.businessObject?.$parent &&
        !(source.type === 'bpmn:Participant' && target.type === 'bpmn:Participant')
      ) {
        throw new BrowserToolError(
          'Message flows must connect elements from different BPMN containers.'
        );
      }
      if (
        connectionType !== 'bpmn:SequenceFlow' &&
        (args.conditionExpression !== undefined || args.isDefault === true)
      ) {
        throw new BrowserToolError(
          'Conditions and default-flow flags are only valid for sequence flows.'
        );
      }
      if (
        args.associationDirection !== undefined &&
        (connectionType !== 'bpmn:Association' ||
          typeof args.associationDirection !== 'string' ||
          !['None', 'One', 'Both'].includes(args.associationDirection))
      ) {
        throw new BrowserToolError(
          '"associationDirection" is only supported for associations as None, One, or Both.'
        );
      }
      if (
        args.isDefault === true &&
        !['bpmn:ExclusiveGateway', 'bpmn:InclusiveGateway', 'bpmn:ComplexGateway'].includes(
          source.type
        )
      ) {
        throw new BrowserToolError('Only a BPMN gateway can own a default sequence flow.');
      }
      if (args.isDefault === true && args.conditionExpression) {
        throw new BrowserToolError(
          'A default sequence flow must not also have a condition expression.'
        );
      }
      const modeling = service<{
        connect(
          source: BrowserElement,
          target: BrowserElement,
          attrs: { type: string }
        ): BrowserElement;
        updateProperties(element: BrowserElement, properties: Record<string, unknown>): void;
      }>(modeler, 'modeling');
      const connection = modeling.connect(source, target, { type: connectionType });
      const connectionProperties: Record<string, unknown> = {};
      if (typeof args.name === 'string' && args.name) connectionProperties.name = args.name;
      if (args.associationDirection !== undefined) {
        connectionProperties.associationDirection = args.associationDirection;
      }
      if (typeof args.conditionExpression === 'string' && args.conditionExpression) {
        const expression = service<{
          create(type: string, properties: Record<string, unknown>): unknown;
        }>(modeler, 'moddle').create('bpmn:FormalExpression', { body: args.conditionExpression });
        connectionProperties.conditionExpression = expression;
      }
      if (Object.keys(connectionProperties).length > 0)
        modeling.updateProperties(connection, connectionProperties);
      if (args.isDefault === true) {
        modeling.updateProperties(source, { default: connection.businessObject });
      }
      return { id: connection.id, type: connection.type };
    }

    case 'set_bpmn_element_properties': {
      allowKeys(args, ['elementId', 'properties']);
      const element = findElement(modeler, stringArg(args, 'elementId'));
      const properties = object(args.properties, '"properties"');
      const changes: Record<string, string | boolean> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (!propertyNames.has(key))
          throw new BrowserToolError(`Unsupported BPMN property "${key}".`);
        const booleanProperty = key === 'asyncBefore' || key === 'asyncAfter';
        if (booleanProperty ? typeof value !== 'boolean' : typeof value !== 'string') {
          throw new BrowserToolError(
            `"${key}" must be a ${booleanProperty ? 'boolean' : 'string'}.`
          );
        }
        if (key !== 'name' && element.type !== 'bpmn:UserTask') {
          throw new BrowserToolError(`"${key}" is only supported on BPMN user tasks.`);
        }
        changes[key] = value as string | boolean;
      }
      if (Object.keys(changes).length === 0)
        throw new BrowserToolError('"properties" cannot be empty.');
      service<{
        updateProperties(element: BrowserElement, properties: Record<string, unknown>): void;
      }>(modeler, 'modeling').updateProperties(element, changes);
      return { id: element.id, properties: changes };
    }

    case 'move_bpmn_element': {
      allowKeys(args, ['elementId', 'dx', 'dy', 'laneId']);
      const element = findElement(modeler, stringArg(args, 'elementId'));
      const dx = args.dx;
      const dy = args.dy;
      if (args.laneId === undefined && dx === undefined && dy === undefined) {
        throw new BrowserToolError('Provide a laneId or at least one move offset.');
      }
      if (
        (dx !== undefined &&
          (typeof dx !== 'number' || !Number.isFinite(dx) || Math.abs(dx) > 10000)) ||
        (dy !== undefined &&
          (typeof dy !== 'number' || !Number.isFinite(dy) || Math.abs(dy) > 10000))
      ) {
        throw new BrowserToolError('"dx" and "dy" must be finite offsets no greater than 10000.');
      }
      if (args.laneId !== undefined) {
        const lane = findElement(modeler, stringArg(args, 'laneId'));
        assignToLane(modeler, lane, [element]);
      }
      const offsetX = typeof dx === 'number' ? dx : 0;
      const offsetY = typeof dy === 'number' ? dy : 0;
      if (offsetX || offsetY) {
        service<{ moveShape(element: BrowserElement, delta: { x: number; y: number }): void }>(
          modeler,
          'modeling'
        ).moveShape(element, { x: offsetX, y: offsetY });
      }
      return { id: element.id, x: element.x, y: element.y };
    }

    case 'delete_bpmn_element': {
      allowKeys(args, ['elementId']);
      const element = findElement(modeler, stringArg(args, 'elementId'));
      service<{ removeElements(elements: BrowserElement[]): void }>(
        modeler,
        'modeling'
      ).removeElements([element]);
      return { deleted: element.id };
    }

    case 'align_bpmn_elements': {
      allowKeys(args, ['elementIds', 'alignment']);
      if (
        !Array.isArray(args.elementIds) ||
        args.elementIds.length < 2 ||
        args.elementIds.length > 40 ||
        args.elementIds.some((id) => typeof id !== 'string')
      ) {
        throw new BrowserToolError('"elementIds" must contain between 2 and 40 element IDs.');
      }
      const elements = (args.elementIds as string[]).map((id) => findElement(modeler, id));
      if (
        elements.some((element) => element.width === undefined || element.height === undefined) ||
        elements.some((element) => element.parent?.id !== elements[0]?.parent?.id)
      ) {
        throw new BrowserToolError(
          'Alignment requires shapes in the same BPMN container; connections and cross-container selections are not supported.'
        );
      }
      const alignment = stringArg(args, 'alignment');
      if (!['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(alignment)) {
        throw new BrowserToolError('Unsupported alignment direction.');
      }
      const modeling = service<{
        moveElements(elements: BrowserElement[], delta: { x: number; y: number }): void;
      }>(modeler, 'modeling');
      const left = Math.min(...elements.map((element) => element.x!));
      const right = Math.max(...elements.map((element) => element.x! + (element.width ?? 0)));
      const top = Math.min(...elements.map((element) => element.y!));
      const bottom = Math.max(...elements.map((element) => element.y! + (element.height ?? 0)));
      for (const element of elements) {
        const dx =
          alignment === 'left'
            ? left - element.x!
            : alignment === 'right'
              ? right - (element.x! + (element.width ?? 0))
              : alignment === 'center'
                ? (left + right) / 2 - (element.x! + (element.width ?? 0) / 2)
                : 0;
        const dy =
          alignment === 'top'
            ? top - element.y!
            : alignment === 'bottom'
              ? bottom - (element.y! + (element.height ?? 0))
              : alignment === 'middle'
                ? (top + bottom) / 2 - (element.y! + (element.height ?? 0) / 2)
                : 0;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
          modeling.moveElements([element], { x: dx, y: dy });
      }
      return { aligned: elements.length, alignment };
    }

    case 'layout_bpmn_diagram':
      allowKeys(args, []);
      if (!context.autoLayout)
        throw new BrowserToolError('Auto layout is unavailable in this browser build.');
      await context.autoLayout();
      return { layout: 'complete' };

    case 'validate_bpmn_diagram':
      allowKeys(args, []);
      if (!context.validate)
        throw new BrowserToolError('BPMN validation is unavailable in this browser build.');
      return { issues: await context.validate() };

    case 'export_bpmn':
      allowKeys(args, []);
      return { xml: (await modeler.saveXML({ format: true })).xml };

    case 'export_bpmn_svg':
      allowKeys(args, []);
      if (!modeler.saveSVG)
        throw new BrowserToolError('SVG export is unavailable in this browser build.');
      return { svg: (await modeler.saveSVG()).svg };

    case 'bpmn_history': {
      allowKeys(args, ['action']);
      const action = stringArg(args, 'action');
      if (action !== 'undo' && action !== 'redo')
        throw new BrowserToolError('"action" must be "undo" or "redo".');
      service<{ undo(): void; redo(): void }>(modeler, 'commandStack')[action]();
      return { action };
    }

    case 'batch_bpmn_operations': {
      allowKeys(args, ['operations']);
      if (
        !Array.isArray(args.operations) ||
        args.operations.length < 1 ||
        args.operations.length > 20
      ) {
        throw new BrowserToolError('"operations" must contain between 1 and 20 operations.');
      }
      const allowedTools = new Set<string>(batchToolNames);
      const results: unknown[] = [];
      for (const [index, rawOperation] of args.operations.entries()) {
        const operation = object(rawOperation, `operations[${index}]`);
        allowKeys(operation, ['tool', 'arguments']);
        const tool = stringArg(operation, 'tool');
        if (!allowedTools.has(tool))
          throw new BrowserToolError(`Unsupported batch tool "${tool}".`);
        try {
          results.push(await dispatchBrowserTool(context, tool, operation.arguments));
        } catch (error) {
          return {
            completed: results,
            failed: {
              index,
              tool,
              error: error instanceof Error ? error.message : 'The operation failed.',
            },
            partial: results.length > 0,
          };
        }
      }
      return { completed: results, partial: false };
    }

    default:
      throw new BrowserToolError(`Unknown browser BPMN tool "${name}".`);
  }
}
