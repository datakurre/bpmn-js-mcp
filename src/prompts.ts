/**
 * MCP Prompts — modeling style toggles.
 *
 * Three prompts that set the modeling context for the agent session.
 * Each instructs the agent on which BPMN structure to use, which tools
 * to call, and reminds it to export the final diagram via export_bpmn.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/** Reusable interface for prompt definitions. */
interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  getMessages: (
    args: Record<string, string>
  ) => Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
}

// ── Shared modeling guidelines ─────────────────────────────────────────────

const SHARED_EFFICIENCY_GUIDELINES =
  `\n\n**Efficiency guidelines:**\n` +
  `- **Batch operations:** When performing multiple sequential operations (adding elements, ` +
  `connecting them, setting properties), prefer wrapping them in a single ` +
  `\`batch_bpmn_operations\` call to reduce round-trips.\n` +
  `- **Visual feedback:** Pass \`includeImage: true\` when calling \`create_bpmn_diagram\` ` +
  `so that every mutating tool response appends a live SVG preview.\n` +
  `- **Reduce noise during construction:** Pass \`hintLevel: "minimal"\` when calling ` +
  `\`create_bpmn_diagram\` to suppress connectivity warnings during incremental building. ` +
  `Switch to full validation at the end via \`validate_bpmn_diagram\`.\n` +
  `- **Always specify \`afterElementId\`** when extending an existing flow with ` +
  `\`add_bpmn_element_chain\` — omitting it creates a disconnected segment that requires ` +
  `extra manual wiring.\n`;

// ── Shared export reminder ─────────────────────────────────────────────────

const EXPORT_REMINDER =
  `\n\n**Export:** When the diagram is complete, always run ` +
  `\`export_bpmn\` with \`format: "both"\` and a \`filePath\` argument to ` +
  `save the BPMN XML to disk. This ensures the work is persisted.\n` +
  `Example: \`export_bpmn({ diagramId, format: "both", filePath: "output/my-process.bpmn" })\``;

// ── Shared boundary event + compensation guidance ──────────────────────────

const BOUNDARY_EVENT_GUIDANCE =
  `\n\n**Boundary event interrupt semantics:**\n` +
  `- **Interrupting** (\`cancelActivity: true\`, solid border, the default): when the event ` +
  `fires, the host activity is **cancelled** and the token leaves via the boundary event path. ` +
  `Use this for **timeout/deadline** scenarios — if the task isn't done in time, cancel it ` +
  `and escalate.\n` +
  `- **Non-interrupting** (\`cancelActivity: false\`, dashed border): the host activity ` +
  `**keeps running** while the event path also executes in parallel. Use this for ` +
  `**escalation reminder** scenarios (e.g. "send reminder email after 30 min while task continues").\n` +
  `- Rule of thumb: ask "Should the host task keep running after this event fires?" ` +
  `— If **no** → interrupting (default). If **yes** (reminder/notification) → non-interrupting.\n` +
  `- ⚠️ A non-interrupting timer whose only path leads to an error end or compensation throw ` +
  `event is almost always a semantic mistake — the host task would keep running as a zombie. ` +
  `Use an interrupting timer instead.\n\n` +
  `**Compensation pattern (CRITICAL — ordering matters):**\n` +
  `Association waypoints are frozen at creation time and \`layout_bpmn_diagram\` does NOT ` +
  `re-route \`bpmn:Association\` edges. Always build compensation in this exact order:\n` +
  `1. Add the compensation handler task with \`isForCompensation: true\`.\n` +
  `2. Add the \`bpmn:BoundaryEvent\` with \`eventDefinitionType: "bpmn:CompensateEventDefinition"\` ` +
  `on the task being compensated.\n` +
  `3. Call \`layout_bpmn_diagram\` **before** connecting, so that all elements have stable ` +
  `canvas positions.\n` +
  `4. Call \`connect_bpmn_elements\` from the compensation boundary event to the handler ` +
  `(auto-detected as a \`bpmn:Association\`).\n` +
  `5. Do NOT use a \`bpmn:SequenceFlow\` from the compensation boundary event — associations only.\n`;
// ── Prompt definitions ─────────────────────────────────────────────────────

const PROMPTS: PromptDefinition[] = [
  {
    name: 'executable',
    title: 'Executable BPMN process (no pool)',
    description:
      'Model an executable Operaton / Camunda 7 process as a flat process without ' +
      'a participant pool. Suitable for simple deployable workflows.',
    arguments: [],
    getMessages: () => [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `You are now operating in **executable BPMN process mode (no pool)** ` +
            `for Operaton / Camunda 7. When the user describes a workflow to model, ` +
            `follow these rules and build the diagram accordingly.\n\n` +
            `**Structure rules:**\n` +
            `- Do NOT create any participant pools — model a flat process.\n` +
            `- The process must be executable: set \`isExecutable: true\` on the process ` +
            `(this is the default for \`create_bpmn_diagram\`).\n` +
            `- Use \`create_bpmn_diagram\` to start, then \`add_bpmn_element\` / ` +
            `\`add_bpmn_element_chain\` / \`connect_bpmn_elements\` to build the flow.\n\n` +
            `**Task configuration (make it deployable):**\n` +
            `- UserTasks: set \`camunda:assignee\` or \`camunda:candidateGroups\`. ` +
            `Add form fields with \`set_bpmn_form_data\` or set \`camunda:formRef\`.\n` +
            `- ServiceTasks: set \`camunda:type\` to "external" and \`camunda:topic\` ` +
            `for external task workers. Note: output mappings on external tasks are set ` +
            `by the worker, not via static expressions in the diagram.\n` +
            `- BusinessRuleTasks: set \`camunda:decisionRef\` to a DMN decision table ID.\n` +
            `- Gateways: always set condition expressions on outgoing flows and mark ` +
            `one flow as the default with \`isDefault: true\`. The default flow must NOT ` +
            `have a conditionExpression — it is the engine fallback. When using ` +
            `\`add_bpmn_element_chain\` with a gateway, inspect the \`connectionIds\` map ` +
            `in the response — flows from elements BEFORE the gateway are already wired ` +
            `and must NOT be recreated with \`connect_bpmn_elements\`.\n\n` +
            `**Retry / loop-back flows (CRITICAL):**\n` +
            `When a flow loops back to a task that already has an incoming flow (e.g. a retry path), ` +
            `you MUST insert an explicit merge gateway first:\n` +
            `1. Use \`add_bpmn_element\` with \`flowId\` set to the existing incoming flow ID to insert an ExclusiveGateway inline.\n` +
            `2. Then connect the retry flow to the new gateway with \`connect_bpmn_elements\`.\n` +
            `Never connect two flows directly into a non-gateway task — this creates an implicit merge that ` +
            `causes multiple token activations at runtime and will block the export lint gate.\n\n` +
            `**Workflow (when the user gives you a process to model):**\n` +
            `1. \`create_bpmn_diagram\` with \`includeImage: true\` and \`hintLevel: "minimal"\`\n` +
            `2. Build the flow using \`batch_bpmn_operations\` to add elements and connections together\n` +
            `3. Configure tasks (camunda:assignee, camunda:topic, etc.)\n` +
            `4. \`layout_bpmn_diagram\` to arrange elements — non-orthogonal (Z-shaped) flows are ` +
            `automatically corrected; re-run layout if \`qualityMetrics.orthogonalFlowPercent\` ` +
            `is still below 90%. If the response lists \`nonOrthogonalFlowIds\`, call ` +
            `\`set_bpmn_connection_waypoints\` for each ID with a 2-point straight path instead ` +
            `of re-running full layout. Use \`layout_bpmn_diagram\` with \`labelsOnly: true\` ` +
            `after structural changes to reposition gateway labels onto their flow-free side ` +
            `without moving other elements.\n` +
            `5. \`validate_bpmn_diagram\` to check for issues\n` +
            `6. Fix any reported issues\n` +
            `7. \`export_bpmn\` with \`filePath\` to save` +
            BOUNDARY_EVENT_GUIDANCE +
            SHARED_EFFICIENCY_GUIDELINES +
            EXPORT_REMINDER,
        },
      },
    ],
  },
  {
    name: 'executable-pool',
    title: 'Executable BPMN process with pool',
    description:
      'Model an executable Operaton / Camunda 7 process wrapped in a participant ' +
      'pool, optionally with swim lanes for role separation and collapsed partner ' +
      'pools for external system documentation.',
    arguments: [],
    getMessages: () => [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `You are now operating in **executable BPMN process mode with a participant pool** ` +
            `for Operaton / Camunda 7. When the user describes a workflow to model, ` +
            `follow these rules and build the diagram accordingly.\n\n` +
            `**Structure rules:**\n` +
            `- Create ONE expanded participant pool for the executable process using ` +
            `\`create_bpmn_participant\`.\n` +
            `- Optionally add **lanes** for role separation: pass a \`lanes\` array to ` +
            `\`create_bpmn_participant\` (e.g. \`lanes: [{ name: "Manager" }, { name: "Clerk" }]\`).\n` +
            `- When placing elements, always specify \`participantId\` (and \`laneId\` if ` +
            `using lanes) in \`add_bpmn_element\` / \`add_bpmn_element_chain\`.\n` +
            `- Optionally add **collapsed partner pools** for external systems: use ` +
            `\`create_bpmn_participant\` with \`participants\` array where partner entries ` +
            `have \`collapsed: true\`. Connect via \`connect_bpmn_elements\` (auto-creates ` +
            `message flows across pools).\n` +
            `- **Only ONE pool is executable** in Camunda 7 — partner pools are for ` +
            `documentation only.\n\n` +
            `**Task configuration (make it deployable):**\n` +
            `- UserTasks: set \`camunda:assignee\` or \`camunda:candidateGroups\`. ` +
            `Match the lane role (e.g. lane "Manager" → candidateGroups: "managers").\n` +
            `- ServiceTasks: set \`camunda:type\` to "external" and \`camunda:topic\`.\n` +
            `- Gateways: always set condition expressions and a default flow. ` +
            `The default flow must NOT have a conditionExpression.\n\n` +
            `**Retry / loop-back flows (CRITICAL):**\n` +
            `When a flow loops back to a task that already has an incoming flow (e.g. a retry path), ` +
            `you MUST insert an explicit merge gateway first:\n` +
            `1. Use \`add_bpmn_element\` with \`flowId\` set to the existing incoming flow ID to insert an ExclusiveGateway inline.\n` +
            `2. Then connect the retry flow to the new gateway with \`connect_bpmn_elements\`.\n` +
            `Never connect two flows directly into a non-gateway task — this creates an implicit merge that ` +
            `causes multiple token activations at runtime and will block the export lint gate.\n\n` +
            `**Workflow (when the user gives you a process to model):**\n` +
            `1. \`create_bpmn_diagram\` with \`includeImage: true\` and \`hintLevel: "minimal"\`\n` +
            `2. \`create_bpmn_participant\` (with optional lanes)\n` +
            `3. Build flow using \`batch_bpmn_operations\` (add elements + connect in one call)\n` +
            `4. \`layout_bpmn_diagram\` — non-orthogonal flows are automatically corrected; ` +
            `re-run if \`qualityMetrics.orthogonalFlowPercent\` < 90%. If the response lists ` +
            `\`nonOrthogonalFlowIds\`, call \`set_bpmn_connection_waypoints\` for each ID with ` +
            `a 2-point straight path instead of re-running full layout. Use ` +
            `\`layout_bpmn_diagram\` with \`labelsOnly: true\` after structural changes to ` +
            `reposition gateway labels onto their flow-free side without moving other elements. ` +
            `→ \`autosize_bpmn_pools_and_lanes\`\n` +
            `5. \`validate_bpmn_diagram\` → fix issues\n` +
            `6. \`export_bpmn\` with \`filePath\` to save` +
            BOUNDARY_EVENT_GUIDANCE +
            SHARED_EFFICIENCY_GUIDELINES +
            EXPORT_REMINDER,
        },
      },
    ],
  },
  {
    name: 'collaboration',
    title: 'Collaboration diagram (documentation)',
    description:
      'Model a non-executable collaboration diagram for documentation purposes. ' +
      'Multiple expanded pools show how different organisations or systems interact ' +
      'via message flows. Not intended for engine deployment.',
    arguments: [],
    getMessages: () => [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `You are now operating in **collaboration diagram mode (documentation)**. ` +
            `This diagram is NOT intended for execution — it documents how multiple ` +
            `organisations or systems interact. When the user describes a collaboration ` +
            `to model, follow these rules and build the diagram accordingly.\n\n` +
            `**Structure rules:**\n` +
            `- Create **multiple expanded participant pools** using ` +
            `\`create_bpmn_participant\` with a \`participants\` array (each with ` +
            `\`collapsed: false\`).\n` +
            `- Each pool represents a separate organisation, department, or system.\n` +
            `- Use **sequence flows** within a pool and **message flows** between pools.\n` +
            `- Message flows are auto-detected by \`connect_bpmn_elements\` when source ` +
            `and target are in different pools.\n` +
            `- Pools may have **lanes** for internal role separation.\n\n` +
            `**Modeling guidelines (documentation focus):**\n` +
            `- Use descriptive names: verb-object for tasks ("Send Invoice"), ` +
            `questions for gateways ("Payment received?").\n` +
            `- Camunda-specific properties (assignee, topic, forms) are optional — ` +
            `this is for human-readable documentation.\n` +
            `- Use \`manage_bpmn_root_elements\` to define shared bpmn:Message elements ` +
            `for cross-pool communication.\n` +
            `- Add text annotations (\`bpmn:TextAnnotation\`) to clarify non-obvious ` +
            `interactions.\n` +
            `- Use SendTask/ReceiveTask or message throw/catch events to make ` +
            `cross-pool communication explicit.\n\n` +
            `**Workflow (when the user gives you a collaboration to model):**\n` +
            `1. \`create_bpmn_diagram\` with \`workflowContext: "multi-organization"\`, ` +
            `\`includeImage: true\`, and \`hintLevel: "minimal"\`\n` +
            `2. \`create_bpmn_participant\` with multiple expanded pools\n` +
            `3. Build each pool's internal flow using \`batch_bpmn_operations\`\n` +
            `4. \`connect_bpmn_elements\` for message flows between pools\n` +
            `5. \`layout_bpmn_diagram\` → \`autosize_bpmn_pools_and_lanes\`\n` +
            `6. \`export_bpmn\` with \`filePath\` and \`skipLint: true\` to save ` +
            `(non-executable diagrams may trigger lint warnings)` +
            SHARED_EFFICIENCY_GUIDELINES +
            EXPORT_REMINDER,
        },
      },
    ],
  },
];

/** List all available prompts. */
export function listPrompts(): Array<{
  name: string;
  title: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}> {
  return PROMPTS.map((p) => ({
    name: p.name,
    title: p.title,
    description: p.description,
    arguments: p.arguments,
  }));
}

/** Get a specific prompt by name, with argument substitution. */
export function getPrompt(
  name: string,
  args: Record<string, string> = {}
): {
  description: string;
  messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
} {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) {
    throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
  }
  return {
    description: prompt.description,
    messages: prompt.getMessages(args),
  };
}
