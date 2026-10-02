/**
 * Static guide content for MCP resource templates.
 *
 * Extracted from resources.ts to keep file sizes under the max-lines lint limit.
 * Each export is a markdown string served via bpmn://guides/{name}.
 */

/**
 * Executable Camunda 7 / Operaton guide.
 *
 * Provides AI callers with constraints and conventions for building
 * processes that can be deployed and executed on Camunda 7 / Operaton.
 */
export const EXECUTABLE_CAMUNDA7_GUIDE = `# Executable BPMN for Camunda 7 / Operaton

## Deployment constraints

- **One executable pool per deployment.** In a collaboration diagram, only one
  participant may have \`isExecutable: true\`. Partner pools must be **collapsed**
  (thin bars) and serve only as message-flow endpoints.
- **Process ID = deployment key.** The \`id\` attribute on \`<bpmn:Process>\` is the
  process definition key used in API calls, REST endpoints, and tasklist queries.
  Use a stable, meaningful kebab-case or camelCase identifier (e.g.
  \`order-processing\`).
- **History time-to-live** is required. Set \`camunda:historyTimeToLive\` on the
  process element (e.g. \`"P30D"\` for 30 days).

## Task types

| BPMN type | Camunda usage | Key properties |
|-----------|---------------|----------------|
| **User Task** | Human work in Tasklist | \`camunda:assignee\`, \`camunda:candidateGroups\`, \`camunda:formKey\` or \`camunda:formRef\` or generated form fields |
| **Service Task (external)** | Polled by external workers | \`camunda:type="external"\`, \`camunda:topic\` |
| **Service Task (Java)** | In-process Java delegate | \`camunda:class\` or \`camunda:delegateExpression\` |
| **Service Task (connector)** | HTTP/REST via connector | \`camunda:connectorId\` |
| **Script Task** | Inline Groovy/JS/JUEL | \`scriptFormat\`, inline script, optional \`camunda:resultVariable\` |
| **Business Rule Task** | DMN decision | \`camunda:decisionRef\`, \`camunda:decisionRefBinding\`, \`camunda:mapDecisionResult\`, \`camunda:decisionRefVersion\` (when binding=version) |
| **Send Task** | Fire-and-forget message | \`camunda:type="external"\`, \`camunda:topic\` (like service task) |
| **Receive Task** | Wait for correlated message | Message reference + correlation key |
| **Call Activity** | Invoke another BPMN process | \`calledElement\`, \`camunda:calledElementBinding\` |

## User Task forms

- **Generated task forms** (\`set_bpmn_form_data\`): simple key/value fields
  embedded in the BPMN XML. Good for prototyping.
- **Camunda Platform Forms** (\`camunda:formRef\`): form designed separately
  (e.g. using @bpmn.io/form-js) and deployed alongside the process.
  Set \`camunda:formRefBinding\` (\`latest\`/\`deployment\`/\`version\`) to control
  version resolution. Use a companion \`form-js-mcp\` server if available
  to design the form.
- **Embedded forms** (\`camunda:formKey: "embedded:app:forms/myform.html"\`):
  custom HTML forms deployed with the application.
- **External forms** (\`camunda:formKey: "app:my-form"\`): separate
  frontend application handles rendering.

## Business Rule Task and DMN

Business Rule Tasks primarily integrate with DMN decision tables:
1. Deploy the DMN table separately (or use a companion \`dmn-js-mcp\` server
   if available to design it).
2. Set \`camunda:decisionRef\` to the decision table ID.
3. Set \`camunda:decisionRefBinding\` (\`latest\`/\`deployment\`/\`version\`)
   and \`camunda:mapDecisionResult\` (\`singleEntry\`/\`singleResult\`/
   \`collectEntries\`/\`resultList\`).
4. Use \`set_bpmn_input_output_mapping\` to map process variables to/from
   the decision input/output columns.

## External Task pattern

1. Set \`camunda:type="external"\` and \`camunda:topic="my-topic"\` on the
   Service Task.
2. Deploy an external task worker that polls for the topic and completes
   or fails the task.
3. For error handling, add \`camunda:ErrorEventDefinition\` entries on the
   service task (not boundary events) to map BPMN errors from worker failures.
4. Retry behavior is configured via \`camunda:asyncBefore\` /
   \`camunda:jobRetryTimeCycle\` or handled by the worker itself.

## Gateways and conditions

- **Exclusive gateway** (XOR): exactly one outgoing flow is taken. Every
  outgoing flow (except the default) must have a \`conditionExpression\`.
  Always mark one flow as \`isDefault: true\`.
- **Parallel gateway** (AND): all outgoing flows are taken. Do **not** set
  conditions. The merging gateway must also be parallel.
- **Inclusive gateway** (OR): one or more flows are taken based on conditions.
  Always set a default flow.
- **Event-based gateway**: waits for the first event to occur among
  intermediate catch events (message, timer, signal).
- Condition expressions use JUEL: \`\${amount > 1000}\`, \`\${approved == true}\`.

## Event handling patterns

- **Boundary events** (on tasks/subprocesses): handle exceptions at a
  specific activity. Interrupting stops the activity; non-interrupting
  lets it continue.
- **Event subprocesses**: handle exceptions anywhere within the parent
  scope. Interrupting cancels the scope; non-interrupting runs in parallel.
- **Timer events**: use ISO 8601 durations (\`PT15M\`, \`P2D\`), dates, or
  cycles (\`R3/PT10M\`).
- **Error events**: use error codes to match specific errors.
  \`bpmn:Error\` root elements define reusable error references.
- **Message events**: use message names for correlation.
  \`bpmn:Message\` root elements define reusable message references.

## Process decomposition strategies

### Call Activities (hierarchical)
- Break large processes into reusable subprocesses.
- Use \`camunda:calledElementBinding="deployment"\` for predictable behavior.
- Map variables with \`camunda:in\` / \`camunda:out\`.

### Message-based integration (distributed)
- Separate processes communicate via message events.
- Each process is independently deployable.
- Requires message correlation (business key or correlation keys).
- Model partner processes as collapsed pools in collaboration diagrams.

### Link events (within a single process)
- Use **Link throw/catch event pairs** to split a long flow into sections
  within the same process, improving readability without creating separate
  deployment units.
- Link events must have matching names (set via \`set_bpmn_element_properties\`'s
  \`eventDefinition\` sub-object with \`eventDefinitionType: "bpmn:LinkEventDefinition"\`
  and \`properties: { name: "LinkName" }\`).
- Multiple throw events can target one catch event (many-to-one pattern).
- Useful for keeping everything in one file while avoiding long, tangled
  sequence flows.

## Common pitfalls

1. **Missing default flow on gateways** — always set \`isDefault: true\` on
   one outgoing flow of exclusive/inclusive gateways.
2. **Expanded partner pools** — only one pool is executable in Camunda 7.
   Use collapsed pools for partners.
3. **Implicit splits** — avoid conditional flows directly on tasks; use
   explicit gateways.
4. **Missing \`camunda:type="external"\`** — setting \`camunda:topic\`
   without \`camunda:type\` creates an invalid configuration.
5. **Parallel gateway merging exclusive paths** — use exclusive gateway
   to merge XOR branches.
6. **No history time-to-live** — Camunda 7 requires this on the process.
7. **Duplicate element names** — each flow node should have a unique name
   within its scope for clarity.
8. **Retry / loop-back flows creating implicit merges** — when a flow loops
   back to a task that already has an incoming flow (e.g. a retry path
   rejoining a task), you MUST insert an explicit merge gateway first.
   Use \`add_bpmn_elements\` with \`flowId\` set to the existing incoming
   flow to insert the gateway in-line, then connect the retry flow to
   that gateway. Never connect two flows directly into a task — this
   creates an implicit merge that causes runtime errors.
`;

/**
 * Element modeling best practices guide.
 *
 * Moved from the add_bpmn_elements tool description to keep tool descriptions
 * focused on parameters. Referenced via bpmn://guides/modeling-elements.
 */
export const MODELING_ELEMENTS_GUIDE = `# BPMN Element Modeling Guide

## Naming conventions

- **Tasks:** verb-object ("Process Order", "Send Invoice", "Review Application")
- **Events:** object-participle or noun-state ("Order Received", "Payment Completed")
- **Gateways:** yes/no question ending with "?" ("Order valid?", "Payment successful?")

## Element type selection

### Tasks
| Type | When to use |
|------|-------------|
| **UserTask** | Human work in Tasklist |
| **ServiceTask** | System integration (external worker, Java delegate, or connector) |
| **ScriptTask** | Inline scripting (Groovy, JavaScript, JUEL) |
| **BusinessRuleTask** | DMN decision table evaluation |
| **SendTask** | Fire-and-forget message dispatch |
| **ReceiveTask** | Wait for a correlated message |
| **ManualTask** | Off-system human work (no tasklist entry) |
| **CallActivity** | Invoke another deployed BPMN process |

### Service integration patterns
- For simple integrations (fire-and-forget or request-response), prefer
  **bpmn:ServiceTask** with \`camunda:type="external"\` and \`camunda:topic\`.
- Use **message throw/catch events** only when modeling explicit message
  exchanges with collapsed partner pools in a collaboration diagram.
- In Camunda 7, only one pool is executable; others are collapsed
  documentation of message endpoints.

## Boundary events

- Use \`elementType=bpmn:BoundaryEvent\` with \`hostElementId\` to attach
  to a task or subprocess.
- Do **NOT** use \`bpmn:IntermediateCatchEvent\` for boundary events —
  that creates a standalone event not attached to any host.
- After adding, use \`set_bpmn_element_properties\`'s \`eventDefinition\`
  sub-object to set the type (error, timer, message, signal).
- Or use the \`eventDefinitionType\` shorthand parameter on \`add_bpmn_elements\`.

## Subprocesses

- By default, \`bpmn:SubProcess\` is created **expanded** (350×200 shape
  with inline children).
- Set \`isExpanded=false\` for a **collapsed** subprocess (small shape
  with a separate drilldown plane).

## Event subprocesses

- Create a \`bpmn:SubProcess\` and set \`triggeredByEvent: true\` via
  \`set_bpmn_element_properties\`.
- The event subprocess needs its own start event with an event definition
  (timer, message, error, signal).
- **Interrupting** cancels the parent scope; **non-interrupting** runs
  in parallel.
- Prefer event subprocesses over boundary events when exception handling
  spans multiple activities or applies to the whole process scope.
`;

/**
 * Element properties reference guide.
 *
 * Moved from the set_bpmn_element_properties tool description to keep tool
 * descriptions focused on the interface. Referenced via bpmn://guides/element-properties.
 */
export const ELEMENT_PROPERTIES_GUIDE = `# Camunda Element Properties Reference

This is the complete catalog of properties supported by \`set_bpmn_element_properties\`.
Use the \`camunda:\` prefix for Camunda extension attributes.

## Standard BPMN properties

- \`name\` — element label/name
- \`isExecutable\` — process executability flag
- \`documentation\` — element documentation text
- \`default\` — default sequence flow ID on exclusive/inclusive gateways
- \`conditionExpression\` — condition on sequence flows (e.g. \`\${approved == true}\`)
- \`isExpanded\` — SubProcess expanded/collapsed toggle

## Camunda properties by element type

### Any element
- \`camunda:asyncBefore\`, \`camunda:asyncAfter\` — async continuation
- \`camunda:retryTimeCycle\` — retry cycle (e.g. \`R3/PT10M\`)
- \`camunda:properties\` — generic key-value pairs (object)

### UserTask
- \`camunda:assignee\` — specific user assignment
- \`camunda:candidateUsers\` — comma-separated user list
- \`camunda:candidateGroups\` — comma-separated group list
- \`camunda:formKey\` — form reference (embedded/external)
- \`camunda:formRef\`, \`camunda:formRefBinding\`, \`camunda:formRefVersion\` — Camunda Platform Forms
- \`camunda:dueDate\`, \`camunda:followUpDate\` — task dates
- \`camunda:priority\` — task priority

### ServiceTask / SendTask
- \`camunda:class\` — Java delegate class
- \`camunda:delegateExpression\` — delegate bean expression
- \`camunda:expression\` — UEL expression
- \`camunda:type\` — task type (e.g. \`"external"\`)
- \`camunda:topic\` — external task topic
- \`camunda:connector\` — connector configuration object
- \`camunda:field\` — field injection array

### ScriptTask
- \`scriptFormat\` — script language (groovy, javascript, etc.)
- \`script\` — inline script body
- \`camunda:resource\` — external script file path
- \`camunda:resultVariable\` — variable to store script result

### BusinessRuleTask
- \`camunda:decisionRef\` — DMN decision table ID
- \`camunda:decisionRefBinding\` — version binding
- \`camunda:mapDecisionResult\` — result mapping strategy

### CallActivity
- \`camunda:calledElementBinding\` — version binding
- \`camunda:calledElementVersion\` — specific version
- \`camunda:calledElementVersionTag\` — version tag

### Process
- \`camunda:historyTimeToLive\` — history retention
- \`camunda:candidateStarterGroups\`, \`camunda:candidateStarterUsers\`
- \`camunda:versionTag\`, \`camunda:isStartableInTasklist\`

### StartEvent
- \`camunda:initiator\` — variable for process initiator
- \`camunda:formKey\`, \`camunda:formRef\` (same as UserTask)

## Related tools

- \`set_bpmn_form_data\` — generated task form fields
- \`set_bpmn_input_output_mapping\` — input/output parameter mappings
- \`set_bpmn_element_properties\`'s \`eventDefinition\` sub-object — event definitions (timer, error, message, etc.)
- \`set_bpmn_loop_characteristics\` — loop/multi-instance configuration
- \`set_bpmn_camunda_listeners\` — execution/task listeners
`;
