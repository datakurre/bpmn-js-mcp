/**
 * Prompt definitions for MCP prompts.
 *
 * Separated from prompts.ts to keep file sizes under the lint limit.
 * Each prompt provides step-by-step instructions for a common BPMN pattern.
 */

/** Reusable interface for prompt definitions. */
export interface PromptDefinition {
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

/** Default placeholder for diagram IDs. */
const DEFAULT_DIAGRAM_ID = '<diagramId>';

/** Default placeholder for element IDs. */
const DEFAULT_ELEMENT_ID = '<elementId>';

// ── Error handling prompt ──────────────────────────────────────────────────

const addErrorHandlingPattern: PromptDefinition = {
  name: 'add-error-handling-pattern',
  title: 'Add error handling pattern',
  description:
    'Add error handling to a service task or subprocess using error boundary events, ' +
    'error end events, and optional retry/escalation paths. Covers both boundary event ' +
    'and event subprocess approaches.',
  arguments: [
    {
      name: 'diagramId',
      description: 'The diagram ID',
      required: true,
    },
    {
      name: 'targetElementId',
      description: 'The ID of the service task or subprocess to add error handling to',
      required: true,
    },
    {
      name: 'errorCode',
      description: 'The error code to catch (e.g. "PAYMENT_FAILED", "VALIDATION_ERROR")',
      required: false,
    },
  ],
  getMessages: (args) => {
    const diagramId = args.diagramId || DEFAULT_DIAGRAM_ID;
    const targetId = args.targetElementId || DEFAULT_ELEMENT_ID;
    const errorCode = args.errorCode || 'ERROR_001';
    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Add error handling to element "${targetId}" in diagram "${diagramId}" ` +
            `for error code "${errorCode}".\n\n` +
            `Follow these steps:\n\n` +
            `1. **Add error boundary event**: Use \`add_bpmn_element\` with:\n` +
            `   - elementType: "bpmn:BoundaryEvent"\n` +
            `   - hostElementId: "${targetId}"\n` +
            `   - eventDefinitionType: "bpmn:ErrorEventDefinition"\n` +
            `   - errorRef: { id: "Error_${errorCode}", name: "${errorCode}", ` +
            `errorCode: "${errorCode}" }\n` +
            `   - name: "${errorCode}"\n` +
            `2. **Add error handling path**: After the boundary event:\n` +
            `   - For retry: add a ServiceTask ("Retry Operation") with a loop or timer\n` +
            `   - For compensation: add tasks to undo/rollback the failed operation\n` +
            `   - For notification: add a SendTask ("Notify Error") to alert stakeholders\n` +
            `   - For escalation: add a UserTask ("Handle Error Manually") assigned to ` +
            `support\n` +
            `3. **End the error path**: Connect to an EndEvent (optionally an Error End ` +
            `Event to propagate the error to a parent process)\n` +
            `4. **Layout**: Run \`layout_bpmn_diagram\` to arrange the error handling path\n\n` +
            `**Advanced: Event subprocess approach** (for errors anywhere in a subprocess):\n` +
            `1. Create a \`bpmn:SubProcess\` and use \`set_bpmn_element_properties\` to set ` +
            `\`triggeredByEvent: true\` and \`isExpanded: true\`\n` +
            `2. Add a StartEvent with \`bpmn:ErrorEventDefinition\` inside the event ` +
            `subprocess\n` +
            `3. Add error handling tasks and an end event\n\n` +
            `**Best practices:**\n` +
            `- Use specific error codes to catch specific errors (not catch-all)\n` +
            `- Always provide a fallback path for unexpected errors\n` +
            `- Consider whether the error should interrupt the task (boundary event) ` +
            `or be handled in parallel (non-interrupting boundary event)\n` +
            `- For external tasks, configure \`camunda:ErrorEventDefinition\` on the ` +
            `ServiceTask to map worker errors to BPMN errors`,
        },
      },
    ];
  },
};

// ── Parallel tasks prompt ──────────────────────────────────────────────────

const addParallelTasksPattern: PromptDefinition = {
  name: 'add-parallel-tasks-pattern',
  title: 'Add parallel execution pattern',
  description:
    'Add a parallel gateway pattern: split into concurrent branches, execute tasks ' +
    'in parallel, and merge with a synchronizing parallel gateway. Includes best ' +
    'practices for parallel execution.',
  arguments: [
    {
      name: 'diagramId',
      description: 'The diagram ID',
      required: true,
    },
    {
      name: 'afterElementId',
      description: 'The ID of the element after which to add the parallel pattern',
      required: true,
    },
    {
      name: 'branches',
      description:
        'Comma-separated list of parallel branch names ' +
        '(e.g. "Check Inventory, Process Payment, Send Confirmation")',
      required: true,
    },
  ],
  getMessages: (args) => {
    const diagramId = args.diagramId || DEFAULT_DIAGRAM_ID;
    const afterId = args.afterElementId || DEFAULT_ELEMENT_ID;
    const branches = args.branches
      ? args.branches.split(',').map((b) => b.trim())
      : ['Task A', 'Task B', 'Task C'];
    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Add a parallel execution pattern after element "${afterId}" in diagram ` +
            `"${diagramId}" with these parallel branches: ${branches.join(', ')}.\n\n` +
            `Follow these steps:\n\n` +
            `1. **Add parallel split gateway**: Use \`add_bpmn_element\` with:\n` +
            `   - elementType: "bpmn:ParallelGateway"\n` +
            `   - name: "" (parallel gateways typically have no label)\n` +
            `   - afterElementId: "${afterId}"\n` +
            `2. **Add parallel branches**: For each branch, add a task:\n` +
            branches
              .map(
                (b, i) =>
                  `   - Branch ${i + 1}: Add a task named "${b}" ` +
                  `(choose UserTask, ServiceTask, etc. as appropriate)`
              )
              .join('\n') +
            `\n` +
            `3. **Connect split gateway to all branches**: Use \`connect_bpmn_elements\` ` +
            `to connect the parallel gateway to each branch task. Do NOT set conditions ` +
            `\u2014 parallel gateways take ALL outgoing flows unconditionally.\n` +
            `4. **Add parallel merge gateway**: Add another \`bpmn:ParallelGateway\` after ` +
            `the branch tasks to synchronize all branches.\n` +
            `5. **Connect branches to merge gateway**: Connect each branch task to the ` +
            `merge gateway.\n` +
            `6. **Continue the flow**: Connect the merge gateway to the next element.\n` +
            `7. **Layout**: Run \`layout_bpmn_diagram\` to arrange the parallel structure.\n\n` +
            `**Best practices:**\n` +
            `- Always use a ParallelGateway (not ExclusiveGateway) for the merge \u2014 ` +
            `the merge waits for ALL branches to complete before continuing.\n` +
            `- Do NOT set conditions on outgoing flows of parallel gateways.\n` +
            `- Do NOT set a default flow on parallel gateways.\n` +
            `- Each branch is independent \u2014 no sequence flows between parallel branches.\n` +
            `- If a branch has multiple tasks, connect them in sequence within the branch.\n` +
            `- Consider adding error boundary events on tasks that might fail.`,
        },
      },
    ];
  },
};

// ── Lane-based process prompt ──────────────────────────────────────────────

const createLaneBasedProcess: PromptDefinition = {
  name: 'create-lane-based-process',
  title: 'Create process with swim lanes for role separation',
  description:
    'Create a BPMN process using swim lanes (within a single pool) to separate work ' +
    'by role or department. Includes guidance on when to use lanes vs. collaboration pools.',
  arguments: [
    {
      name: 'processName',
      description: 'Name for the process (e.g. "Order Fulfillment")',
      required: true,
    },
    {
      name: 'roles',
      description:
        'Comma-separated list of roles/departments ' +
        '(e.g. "Customer Service, Warehouse, Shipping")',
      required: true,
    },
    {
      name: 'description',
      description: 'Brief description of what the process should do',
      required: false,
    },
  ],
  getMessages: (args) => {
    const name = args.processName || 'My Process';
    const roles = args.roles ? args.roles.split(',').map((r) => r.trim()) : ['Role A', 'Role B'];
    const desc = args.description ? `\n\nProcess description: ${args.description}` : '';
    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Create a lane-based BPMN process called "${name}" with roles: ${roles.join(', ')}.${desc}\n\n` +
            `**When to use lanes vs. pools:**\n` +
            `- **Lanes** (swim lanes within a single pool): Use when the roles are ` +
            `within the same organisation or process — e.g. departments, job roles, ` +
            `teams that share a common workflow. Elements are connected with sequence flows.\n` +
            `- **Pools** (collaboration diagram): Use when modelling separate organisations ` +
            `or independent systems that communicate via messages — e.g. Customer ↔ Supplier, ` +
            `or your system ↔ external payment gateway. Elements across pools use message flows.\n\n` +
            `This process uses **lanes** because ${roles.join(', ')} are roles within the same process.\n\n` +
            `Follow these steps:\n\n` +
            `1. **Create diagram**: Use \`create_bpmn_diagram\` with name "${name}"\n` +
            `2. **Build the process flow**: Add all tasks, gateways, and events ` +
            `using \`add_bpmn_element\` and \`connect_bpmn_elements\`. ` +
            `Name every element with verb-object pattern.\n` +
            `3. **Wrap in collaboration**: Use \`wrap_bpmn_process_in_collaboration\` with ` +
            `participantName "${name}"\n` +
            `4. **Create lanes**: Use \`create_bpmn_lanes\` with the participant ID and lanes:\n` +
            roles.map((r) => `   - { name: "${r}" }`).join('\n') +
            `\n` +
            `5. **Assign elements to lanes**: Use \`assign_bpmn_elements_to_lane\` to place ` +
            `each task in the appropriate lane based on which role performs it. ` +
            `Assign start/end events to the role that initiates/completes the process.\n` +
            `6. **Configure tasks**: Set \`camunda:candidateGroups\` on UserTasks ` +
            `to match the lane role (e.g. tasks in "Customer Service" lane → ` +
            `candidateGroups: "customer-service")\n` +
            `7. **Layout**: Run \`layout_bpmn_diagram\` with laneStrategy "optimize" ` +
            `to arrange elements within lanes and minimise cross-lane flows\n` +
            `8. **Validate**: Run \`validate_bpmn_diagram\` and fix any issues\n\n` +
            `**Best practices:**\n` +
            `- Keep related tasks in the same lane to minimise cross-lane sequence flows\n` +
            `- Start events typically go in the lane of the initiating role\n` +
            `- Use exclusive gateways when decisions are made by a specific role\n` +
            `- Avoid putting the same role's tasks in multiple lanes\n` +
            `- If you have > 5 lanes, consider decomposing into subprocesses`,
        },
      },
    ];
  },
};

/** Additional prompts defined in this module. */
export const ADDITIONAL_PROMPTS: PromptDefinition[] = [
  addErrorHandlingPattern,
  addParallelTasksPattern,
  createLaneBasedProcess,
];
