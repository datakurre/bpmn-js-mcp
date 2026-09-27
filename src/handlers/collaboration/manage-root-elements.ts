/**
 * Handler for manage_bpmn_root_elements tool.
 *
 * Manages shared root-level bpmn:Message and bpmn:Signal definitions that
 * can be referenced from multiple events across the diagram.
 */
// @mutating

import { type ToolResult } from '../../types';
import { missingRequiredError } from '../../errors';
import {
  requireDiagram,
  jsonResult,
  syncXml,
  validateArgs,
  resolveOrCreateMessage,
  resolveOrCreateSignal,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface ManageRootElementsArgs {
  diagramId: string;
  messages?: Array<{ id: string; name?: string }>;
  signals?: Array<{ id: string; name?: string }>;
}

export async function handleManageRootElements(args: ManageRootElementsArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId, messages = [], signals = [] } = args;

  if (messages.length === 0 && signals.length === 0) {
    throw missingRequiredError(['messages', 'signals']);
  }

  const diagram = requireDiagram(diagramId);
  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const canvas = getService(diagram.modeler, 'canvas');
  const rootElement = canvas.getRootElement();
  const definitions = rootElement.businessObject.$parent;

  const createdMessages: Array<{ id: string; name: string }> = [];
  const createdSignals: Array<{ id: string; name: string }> = [];

  for (const msg of messages) {
    const msgEl = resolveOrCreateMessage(moddle, modeling, rootElement, definitions, msg);
    createdMessages.push({ id: msgEl.id, name: msgEl.name });
  }

  for (const sig of signals) {
    const sigEl = resolveOrCreateSignal(moddle, modeling, rootElement, definitions, sig);
    createdSignals.push({ id: sigEl.id, name: sigEl.name });
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    messages: createdMessages,
    signals: createdSignals,
    message: `Created/updated ${createdMessages.length} message(s) and ${createdSignals.length} signal(s)`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'manage_bpmn_root_elements',
  description:
    "Create or update shared root-level bpmn:Message and bpmn:Signal definitions. These shared definitions can be referenced from multiple event definitions across the diagram via messageRef/signalRef in set_bpmn_element_properties's eventDefinition sub-object.",
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      messages: {
        type: 'array',
        description: 'Message definitions to create or update',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Message element ID' },
            name: { type: 'string', description: 'Message name' },
          },
          required: ['id'],
        },
      },
      signals: {
        type: 'array',
        description: 'Signal definitions to create or update',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Signal element ID' },
            name: { type: 'string', description: 'Signal name' },
          },
          required: ['id'],
        },
      },
    },
    required: ['diagramId'],
  },
} as const;
