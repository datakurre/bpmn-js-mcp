# Common BPMN MCP Workflows

Example tool-call sequences for frequently needed BPMN modelling patterns.

---

## 1. Create a simple sequential process

Build a Start → Task → End flow from scratch.

```
1. create_bpmn_diagram        → { name: "Order Processing" }
2. add_bpmn_elements          → { elements: [{ elementType: "bpmn:StartEvent", name: "Order Received" }] }
3. add_bpmn_elements          → { elements: [{ elementType: "bpmn:UserTask",   name: "Review Order", afterElementId: "<startId>" }] }
4. add_bpmn_elements          → { elements: [{ elementType: "bpmn:EndEvent",   name: "Done", afterElementId: "<taskId>" }] }
5. layout_bpmn_diagram        → { }
6. export_bpmn                → { format: "xml" }
```

Steps 2–4 can be a single call: `add_bpmn_elements` with `elements: [StartEvent, UserTask, EndEvent]`
connects them in order (`connect: "chain"`, the default) and lays the diagram out.

`afterElementId` auto-positions the new element to the right and
creates a connecting sequence flow in one step.

---

## 2. Insert a task into an existing flow

Add a step between two already-connected elements without
manually deleting/reconnecting flows.

```
1. list_bpmn_elements         → find the flow ID between the two elements
2. add_bpmn_elements           → { elements: [{ flowId: "<flowId>", elementType: "bpmn:UserTask", name: "Verify Data" }] }
```

The tool splits the sequence flow, creates the new element at the
midpoint, and reconnects both sides. If there isn't enough
horizontal space, downstream elements are automatically shifted
right.

---

## 3. Add a parallel branch (fork and join)

Create two tasks that execute in parallel.

```
1. add_bpmn_elements          → { elements: [{ elementType: "bpmn:ParallelGateway", name: "Fork",  afterElementId: "<precedingTaskId>" }] }
2. add_bpmn_elements          → { elements: [{ elementType: "bpmn:ServiceTask",     name: "Send Email",       afterElementId: "<forkGatewayId>", autoConnect: false }] }
3. add_bpmn_elements          → { elements: [{ elementType: "bpmn:ServiceTask",     name: "Update Inventory",  afterElementId: "<forkGatewayId>", autoConnect: false }] }
4. connect_bpmn_elements      → { sourceElementId: "<forkGatewayId>",  targetElementId: "<emailTaskId>" }
5. connect_bpmn_elements      → { sourceElementId: "<forkGatewayId>",  targetElementId: "<inventoryTaskId>" }
6. add_bpmn_elements          → { elements: [{ elementType: "bpmn:ParallelGateway", name: "Join" }] }
7. connect_bpmn_elements      → { sourceElementId: "<emailTaskId>",      targetElementId: "<joinGatewayId>" }
8. connect_bpmn_elements      → { sourceElementId: "<inventoryTaskId>",  targetElementId: "<joinGatewayId>" }
9. layout_bpmn_diagram        → { }   ← cleans up the parallel branches
```

---

## 4. Add an exclusive decision gateway

Route the flow based on a condition.

```
1. add_bpmn_elements          → { elements: [{ elementType: "bpmn:ExclusiveGateway", name: "Order valid?", afterElementId: "<reviewTaskId>" }] }
2. add_bpmn_elements          → { elements: [{ elementType: "bpmn:ServiceTask", name: "Process Order" }] }
3. add_bpmn_elements          → { elements: [{ elementType: "bpmn:EndEvent",    name: "Rejected" }] }
4. connect_bpmn_elements      → { sourceElementId: "<gatewayId>", targetElementId: "<processTaskId>",
                                   label: "Yes", conditionExpression: "${valid == true}" }
5. connect_bpmn_elements      → { sourceElementId: "<gatewayId>", targetElementId: "<rejectedEndId>",
                                   label: "No", isDefault: true }
6. layout_bpmn_diagram        → { }
```

---

## 5. Add a user form to a task

Attach generated task form fields to a UserTask.

```
1. set_bpmn_form_data         → {
     elementId: "<userTaskId>",
     fields: [
       { id: "name",    label: "Full Name", type: "string",  validation: [{ name: "required" }] },
       { id: "email",   label: "Email",     type: "string",  validation: [{ name: "required" }] },
       { id: "amount",  label: "Amount",    type: "long",    validation: [{ name: "min", config: "1" }] },
       { id: "urgent",  label: "Urgent?",   type: "boolean", defaultValue: "false" },
       { id: "priority", label: "Priority",  type: "enum",
         values: [{ id: "low", name: "Low" }, { id: "medium", name: "Medium" }, { id: "high", name: "High" }] }
     ]
   }
```

---

## 6. Attach a boundary timer event

Interrupt a task after a timeout.

```
1. add_bpmn_elements          → { elements: [{ elementType: "bpmn:BoundaryEvent", hostElementId: "<userTaskId>",
                                   name: "Timeout" }] }
2. set_bpmn_event_definition  → { elementId: "<boundaryEventId>",
                                   eventDefinitionType: "bpmn:TimerEventDefinition",
                                   properties: { timeDuration: "PT24H" } }
3. add_bpmn_elements          → { elements: [{ elementType: "bpmn:EndEvent", name: "Escalated" }] }
4. connect_bpmn_elements      → { sourceElementId: "<boundaryEventId>", targetElementId: "<escalatedEndId>" }
```

---

## 7. Create a collaboration diagram (pool with external partner)

Model message exchange between your process and an external system.
In Camunda 7, only one pool is executable; additional pools are
collapsed to document message endpoints.

```
1. create_bpmn_participant   → {
     participants: [
       { name: "Order Service", collapsed: false, width: 800 },
       { name: "Payment Provider", collapsed: true }
     ]
   }
2. add_bpmn_elements           → (build process inside "Order Service" pool)
   ...
3. connect_bpmn_elements      → { sourceElementId: "<sendTaskId>",
                                   targetElementId: "<paymentPoolId>" }
   (auto-detects MessageFlow for cross-pool connection)
```

---

## 8. Add error handling with an event subprocess

Handle errors that can occur anywhere in the process scope.

```
1. add_bpmn_elements          → { elements: [{ elementType: "bpmn:SubProcess", name: "Error Handler" }] }
2. set_bpmn_element_properties → { elementId: "<subProcessId>",
                                    properties: { triggeredByEvent: true, isExpanded: true } }
3. add_bpmn_elements          → { elements: [{ elementType: "bpmn:StartEvent", name: "Error Caught",
                                   participantId: "<subProcessId>" }] }
4. set_bpmn_event_definition  → { elementId: "<errorStartId>",
                                   eventDefinitionType: "bpmn:ErrorEventDefinition",
                                   errorRef: { id: "Error_Timeout", name: "Timeout", errorCode: "ERR_TIMEOUT" } }
5. add_bpmn_elements          → { elements: [{ elementType: "bpmn:ServiceTask", name: "Notify Admin",
                                   afterElementId: "<errorStartId>" }] }
6. add_bpmn_elements          → { elements: [{ elementType: "bpmn:EndEvent", name: "Handled",
                                   afterElementId: "<notifyTaskId>" }] }
```

---

## 9. Configure an external service task (Camunda 7)

```
1. add_bpmn_elements           → { elements: [{ elementType: "bpmn:ServiceTask", name: "Send Invoice" }] }
2. set_bpmn_element_properties → { elementId: "<serviceTaskId>",
                                    properties: {
                                      "camunda:type": "external",
                                      "camunda:topic": "send-invoice"
                                    } }
3. set_bpmn_input_output_mapping → { elementId: "<serviceTaskId>",
                                      inputParameters:  [{ name: "orderId", value: "${orderId}" }],
                                      outputParameters: [{ name: "invoiceId", value: "${invoiceId}" }] }
```

---

## 10. Multi-instance (parallel loop) over a collection

```
1. set_bpmn_loop_characteristics → { elementId: "<taskId>",
                                      loopType: "parallel",
                                      collection: "items",
                                      elementVariable: "item" }
```

---

## 11. Organize a process into swimlanes by role

Create a pool with lanes and assign tasks to the appropriate lane.

```
1. create_bpmn_diagram           → { name: "Approval Process" }
2. add_bpmn_elements             → { elements: [{ elementType: "bpmn:StartEvent", name: "Request Submitted" }] }
3. add_bpmn_elements             → { elements: [{ elementType: "bpmn:UserTask", name: "Review Request",
                                      afterElementId: "<startId>" }] }
4. add_bpmn_elements             → { elements: [{ elementType: "bpmn:UserTask", name: "Approve Request",
                                      afterElementId: "<reviewId>" }] }
5. add_bpmn_elements             → { elements: [{ elementType: "bpmn:EndEvent", name: "Completed",
                                      afterElementId: "<approveId>" }] }
6. create_bpmn_participant       → { wrapExisting: true, name: "Approval Process" }
7. create_bpmn_lanes             → { participantId: "<poolId>",
                                      lanes: [{ name: "Requester" }, { name: "Approver" }] }
8. create_bpmn_lanes             → { assignments: [
                                      { laneId: "<requesterId>", elementIds: ["<startId>", "<reviewId>"] },
                                      { laneId: "<approverId>", elementIds: ["<approveId>", "<endId>"] }] }
9. layout_bpmn_diagram          → { }
```

The layout response includes `laneCrossingMetrics` showing how many
flows cross lane boundaries and a `laneCoherenceScore` (0–100%).

---

## 12. Refactor a flat process into a multi-lane structure

Migrate an existing flat process into lanes without duplicating elements.

```
1. list_bpmn_elements            → identify element IDs and their roles
2. create_bpmn_participant       → { wrapExisting: true, name: "My Process" }
3. create_bpmn_lanes             → { participantId: "<poolId>",
                                      lanes: [
                                        { name: "Customer" },
                                        { name: "Support" },
                                        { name: "System" }
                                      ] }
4. create_bpmn_lanes (assignments)  → { laneId: "<customerId>",
                                      elementIds: ["<startId>", "<submitTaskId>"] }
5. create_bpmn_lanes (assignments)  → { laneId: "<supportId>",
                                      elementIds: ["<reviewTaskId>", "<approveTaskId>"] }
6. create_bpmn_lanes (assignments)  → { laneId: "<systemId>",
                                      elementIds: ["<notifyTaskId>", "<endId>"] }
7. layout_bpmn_diagram           → { }
```

**Key points:**

- `create_bpmn_participant` with `wrapExisting: true` preserves existing elements — no duplication.
- Assign elements to lanes by **role** (Requester, Approver, Finance),
  not by task type (UserTask, ServiceTask).
- Keep 2–3 lanes for readability. More than 4 usually means the process
  should be decomposed.
- Avoid zigzag flows (A → B → A lane crossings) — they reduce readability.

---

## 13. Create a cross-lane handoff

Use `add_bpmn_elements` with `fromElementId` + `toLaneId` when one role passes work to another.

```
1. add_bpmn_elements             → { elements: [{ elementType: "bpmn:UserTask",
                                      fromElementId: "<customerTaskId>",
                                      toLaneId: "<supportLaneId>",
                                      name: "Handle Request" }] }
```

This creates a new task in the target lane and connects it to the
source element with a sequence flow — a clean cross-lane handoff.

---

## Tips

- **Use `layout_bpmn_diagram` after structural changes** (adding
  gateways, parallel branches) to get a clean automatic layout.
- **Avoid full layout** on diagrams with careful manual positioning,
  boundary events, or custom labels. Use `scopeElementId` or
  `elementIds` for partial re-layout instead.
- **Use `add_bpmn_elements` with `flowId`** instead of the manual 3-step pattern
  (delete flow → add element → reconnect) when adding a step into an
  existing flow.
- **Validate before exporting:** `export_bpmn` runs bpmnlint by
  default and blocks on errors. Use `validate_bpmn_diagram` to
  preview issues before export.
- **Batch operations** with `batch_bpmn_operations` to reduce
  round-trips when building complex diagrams.
- **Use `laneId` when adding elements** to a process that already has
  lanes. This avoids the separate `create_bpmn_lanes (assignments)` step.
- **Check `laneCrossingMetrics`** in layout results to assess lane
  organization quality. A `laneCoherenceScore` above 70% indicates
  well-organized lanes.

---

## 14. Round-trip file editing (open → edit → save)

Load an existing `.bpmn` file, make changes, and write it back.

```
1. create_bpmn_diagram          → { filePath: "./process.bpmn" }
2. (make changes using any MCP tools: add elements, set properties, etc.)
3. export_bpmn                 → { format: "xml", filePath: "./process.bpmn" }
```

Both `create_bpmn_diagram` and `export_bpmn` support `filePath` for
direct file I/O. This replaces the error-prone manual pattern of
exporting XML, then using `replace_string_in_file` to update the file.

**Important:** Always use MCP tools for `.bpmn` file modifications.
Never edit BPMN XML directly with text-editing tools — the MCP tools
ensure valid BPMN 2.0 structure, proper DI coordinates, and semantic
correctness.

---

## 15. Insert an element into a cross-lane flow

When inserting into a flow that crosses lane boundaries, use `laneId`
to control which lane the new element lands in.

```
1. list_bpmn_elements          → find the flow ID and lane IDs
2. add_bpmn_elements           → { elements: [{ flowId: "<flowId>",
                                    elementType: "bpmn:IntermediateCatchEvent",
                                    name: "Wait for Approval",
                                    laneId: "<approverLaneId>" }] }
```

Without `laneId`, the element is placed at the midpoint between the
flow's source and target — which may land in an unrelated lane when
the flow crosses lanes vertically. When no `laneId` is specified and
the flow crosses lanes, the element is automatically placed in the
source element's lane to avoid landing in an unrelated middle lane.

---

## 16. Manually route a loopback flow

`layout_bpmn_diagram` (delegated to `bpmn-auto-layout`) routes loop-back
flows automatically — run it after adding a "No"/retry branch that loops
back to an earlier task rather than routing it by hand.

If a specific connection still needs a custom path, use
`connect_bpmn_elements` with `connectionId` + `waypoints` to set an
explicit route:

```
1. list_bpmn_elements     → find the loopback flow ID and element positions
2. connect_bpmn_elements  → { connectionId: "Flow_No",
                               waypoints: [
                                 { x: 425, y: 230 },   // gateway bottom
                                 { x: 425, y: 350 },   // drop down
                                 { x: 250, y: 350 },   // go left
                                 { x: 250, y: 230 }    // rise up to target
                               ] }
```

The waypoints should:

- Start at the gateway's bottom center
- Drop below the main path (50–100px gap)
- Run horizontally back to the target
- Rise up to the target's bottom center
