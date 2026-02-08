import { describe, it, expect, beforeEach } from "vitest";
import {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleDeleteElement,
  handleMoveElement,
  handleGetProperties,
  handleExportXml,
  handleExportSvg,
  handleListElements,
  handleSetProperties,
  handleImportXml,
  handleDeleteDiagram,
  handleListDiagrams,
  handleCloneDiagram,
  handleValidate,
  handleAlignElements,
  handleDistributeElements,
  handleSetInputOutput,
  handleSetEventDefinition,
  handleSetFormData,
  handleLayoutDiagram,
  handleSetCamundaErrorEventDefinition,
  handleSetLoopCharacteristics,
  dispatchToolCall,
} from "../src/handlers";
import { clearDiagrams, INITIAL_XML } from "../src/diagram-manager";

// Helper to parse JSON text from the first content item
function parseResult(result: any) {
  return JSON.parse(result.content[0].text);
}

/** Create a diagram and return its ID. */
async function createDiagram(name?: string) {
  return parseResult(await handleCreateDiagram({ name })).diagramId as string;
}

/** Add an element and return its ID. */
async function addElement(
  diagramId: string,
  elementType: string,
  opts: Record<string, any> = {},
) {
  return parseResult(
    await handleAddElement({ diagramId, elementType, ...opts }),
  ).elementId as string;
}

describe("tool-handlers", () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── create ──────────────────────────────────────────────────────────────

  describe("handleCreateDiagram", () => {
    it("returns success with a diagramId", async () => {
      const res = parseResult(await handleCreateDiagram({}));
      expect(res.success).toBe(true);
      expect(res.diagramId).toMatch(/^diagram_/);
    });

    it("sets process name when provided", async () => {
      const diagramId = await createDiagram("My Process");
      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("My Process");
    });
  });

  // ── add element ─────────────────────────────────────────────────────────

  describe("handleAddElement", () => {
    it("adds a start event and returns its id", async () => {
      const diagramId = await createDiagram();
      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: "bpmn:StartEvent",
          name: "Begin",
          x: 150,
          y: 200,
        }),
      );
      expect(res.success).toBe(true);
      expect(res.elementId).toBeDefined();
      expect(res.elementType).toBe("bpmn:StartEvent");
    });

    it("throws for unknown diagram", async () => {
      await expect(
        handleAddElement({ diagramId: "bad", elementType: "bpmn:Task" }),
      ).rejects.toThrow(/Diagram not found/);
    });

    it("auto-positions after another element", async () => {
      const diagramId = await createDiagram();
      const firstId = await addElement(diagramId, "bpmn:StartEvent", {
        x: 100,
        y: 100,
      });
      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: "bpmn:Task",
          afterElementId: firstId,
        }),
      );
      // The new element should be to the right of the first
      expect(res.position.x).toBeGreaterThan(100);
    });

    it("throws when adding BoundaryEvent without hostElementId", async () => {
      const diagramId = await createDiagram();
      await expect(
        handleAddElement({
          diagramId,
          elementType: "bpmn:BoundaryEvent",
        }),
      ).rejects.toThrow(/hostElementId/);
    });

    it("attaches BoundaryEvent to a host task", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "My Task",
        x: 200,
        y: 200,
      });
      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: "bpmn:BoundaryEvent",
          hostElementId: taskId,
          x: 220,
          y: 260,
        }),
      );
      expect(res.success).toBe(true);
      expect(res.elementId).toBeDefined();
    });
  });

  // ── connect ─────────────────────────────────────────────────────────────

  describe("handleConnect", () => {
    it("connects two elements", async () => {
      const diagramId = await createDiagram();
      const aId = await addElement(diagramId, "bpmn:StartEvent", {
        x: 100,
        y: 100,
      });
      const bId = await addElement(diagramId, "bpmn:EndEvent", {
        x: 300,
        y: 100,
      });

      const conn = parseResult(
        await handleConnect({
          diagramId,
          sourceElementId: aId,
          targetElementId: bId,
          label: "done",
        }),
      );
      expect(conn.success).toBe(true);
      expect(conn.connectionId).toBeDefined();
    });

    it("defaults to SequenceFlow type", async () => {
      const diagramId = await createDiagram();
      const aId = await addElement(diagramId, "bpmn:StartEvent", {
        x: 100,
        y: 100,
      });
      const bId = await addElement(diagramId, "bpmn:EndEvent", {
        x: 300,
        y: 100,
      });
      const conn = parseResult(
        await handleConnect({
          diagramId,
          sourceElementId: aId,
          targetElementId: bId,
        }),
      );
      expect(conn.connectionType).toBe("bpmn:SequenceFlow");
    });

    it("throws when source missing", async () => {
      const diagramId = await createDiagram();
      const bId = await addElement(diagramId, "bpmn:EndEvent", {
        x: 300,
        y: 100,
      });
      await expect(
        handleConnect({
          diagramId,
          sourceElementId: "no",
          targetElementId: bId,
        }),
      ).rejects.toThrow(/Source element not found/);
    });

    it("throws when target missing", async () => {
      const diagramId = await createDiagram();
      const aId = await addElement(diagramId, "bpmn:StartEvent", {
        x: 100,
        y: 100,
      });
      await expect(
        handleConnect({
          diagramId,
          sourceElementId: aId,
          targetElementId: "no",
        }),
      ).rejects.toThrow(/Target element not found/);
    });
  });

  // ── delete element ──────────────────────────────────────────────────────

  describe("handleDeleteElement", () => {
    it("removes an element from the diagram", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:Task", {
        name: "To delete",
      });

      const res = parseResult(
        await handleDeleteElement({ diagramId, elementId: taskId }),
      );
      expect(res.success).toBe(true);

      // Element should no longer appear in list
      const list = parseResult(
        await handleListElements({ diagramId }),
      );
      expect(list.elements.find((e: any) => e.id === taskId)).toBeUndefined();
    });

    it("throws for unknown element", async () => {
      const diagramId = await createDiagram();
      await expect(
        handleDeleteElement({ diagramId, elementId: "ghost" }),
      ).rejects.toThrow(/Element not found/);
    });
  });

  // ── move element ────────────────────────────────────────────────────────

  describe("handleMoveElement", () => {
    it("moves an element to new coordinates", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:Task", {
        x: 100,
        y: 100,
      });

      const res = parseResult(
        await handleMoveElement({ diagramId, elementId: taskId, x: 500, y: 400 }),
      );
      expect(res.success).toBe(true);
      expect(res.position.x).toBe(500);
      expect(res.position.y).toBe(400);
    });
  });

  // ── get properties ──────────────────────────────────────────────────────

  describe("handleGetProperties", () => {
    it("returns element properties", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:UserTask", {
        name: "Review",
      });
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        properties: { "camunda:assignee": "alice" },
      });

      const res = parseResult(
        await handleGetProperties({ diagramId, elementId: taskId }),
      );
      expect(res.type).toBe("bpmn:UserTask");
      expect(res.name).toBe("Review");
      expect(res.camundaProperties["camunda:assignee"]).toBe("alice");
    });

    it("includes incoming/outgoing connections", async () => {
      const diagramId = await createDiagram();
      const aId = await addElement(diagramId, "bpmn:StartEvent", {
        x: 100,
        y: 100,
      });
      const bId = await addElement(diagramId, "bpmn:EndEvent", {
        x: 300,
        y: 100,
      });
      await handleConnect({
        diagramId,
        sourceElementId: aId,
        targetElementId: bId,
      });

      const res = parseResult(
        await handleGetProperties({ diagramId, elementId: bId }),
      );
      expect(res.incoming).toBeDefined();
      expect(res.incoming.length).toBe(1);
    });
  });

  // ── export XML ──────────────────────────────────────────────────────────

  describe("handleExportXml", () => {
    it("returns BPMN XML string", async () => {
      const diagramId = await createDiagram();
      const res = await handleExportXml({ diagramId });
      expect(res.content[0].text).toContain("<bpmn:definitions");
    });

    it("warns when elements are disconnected", async () => {
      const diagramId = await createDiagram();
      await addElement(diagramId, "bpmn:StartEvent", { x: 100, y: 100 });
      await addElement(diagramId, "bpmn:EndEvent", { x: 300, y: 100 });

      const res = await handleExportXml({ diagramId });
      expect(res.content.length).toBeGreaterThan(1);
      expect(res.content[1].text).toContain("flows");
    });
  });

  // ── export SVG ──────────────────────────────────────────────────────────

  describe("handleExportSvg", () => {
    it("returns SVG markup", async () => {
      const diagramId = await createDiagram();
      const res = await handleExportSvg({ diagramId });
      expect(res.content[0].text).toContain("<svg");
    });

    it("includes connectivity warnings", async () => {
      const diagramId = await createDiagram();
      await addElement(diagramId, "bpmn:StartEvent", { x: 100, y: 100 });
      await addElement(diagramId, "bpmn:EndEvent", { x: 300, y: 100 });

      const res = await handleExportSvg({ diagramId });
      expect(res.content.length).toBeGreaterThan(1);
      expect(res.content[1].text).toContain("flows");
    });
  });

  // ── list elements ───────────────────────────────────────────────────────

  describe("handleListElements", () => {
    it("lists added elements", async () => {
      const diagramId = await createDiagram();
      await addElement(diagramId, "bpmn:Task", { name: "Do stuff" });

      const res = parseResult(await handleListElements({ diagramId }));
      expect(res.count).toBeGreaterThanOrEqual(1);
      const task = res.elements.find((e: any) => e.type === "bpmn:Task");
      expect(task).toBeDefined();
      expect(task.name).toBe("Do stuff");
    });

    it("includes connection info for connected elements", async () => {
      const diagramId = await createDiagram();
      const aId = await addElement(diagramId, "bpmn:StartEvent", {
        x: 100,
        y: 100,
      });
      const bId = await addElement(diagramId, "bpmn:EndEvent", {
        x: 300,
        y: 100,
      });
      await handleConnect({
        diagramId,
        sourceElementId: aId,
        targetElementId: bId,
      });

      const res = parseResult(await handleListElements({ diagramId }));
      const startEl = res.elements.find((e: any) => e.id === aId);
      expect(startEl.outgoing).toBeDefined();
      expect(startEl.outgoing.length).toBe(1);
    });

    it("includes connection source/target info", async () => {
      const diagramId = await createDiagram();
      const aId = await addElement(diagramId, "bpmn:StartEvent", {
        x: 100,
        y: 100,
      });
      const bId = await addElement(diagramId, "bpmn:EndEvent", {
        x: 300,
        y: 100,
      });
      await handleConnect({
        diagramId,
        sourceElementId: aId,
        targetElementId: bId,
      });

      const res = parseResult(await handleListElements({ diagramId }));
      const flow = res.elements.find(
        (e: any) => e.type === "bpmn:SequenceFlow",
      );
      expect(flow).toBeDefined();
      expect(flow.sourceId).toBe(aId);
      expect(flow.targetId).toBe(bId);
    });
  });

  // ── set properties ──────────────────────────────────────────────────────

  describe("handleSetProperties", () => {
    it("sets camunda properties on an element", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:UserTask", {
        name: "Review",
      });

      const res = parseResult(
        await handleSetProperties({
          diagramId,
          elementId: taskId,
          properties: { "camunda:assignee": "john" },
        }),
      );
      expect(res.success).toBe(true);
      expect(res.updatedProperties).toContain("camunda:assignee");

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("camunda:assignee");
    });

    it("throws for unknown element", async () => {
      const diagramId = await createDiagram();
      await expect(
        handleSetProperties({
          diagramId,
          elementId: "ghost",
          properties: { name: "x" },
        }),
      ).rejects.toThrow(/Element not found/);
    });
  });

  // ── import XML ──────────────────────────────────────────────────────────

  describe("handleImportXml", () => {
    it("imports valid BPMN XML and returns a new diagramId", async () => {
      const res = parseResult(
        await handleImportXml({ xml: INITIAL_XML }),
      );
      expect(res.success).toBe(true);
      expect(res.diagramId).toMatch(/^diagram_/);
    });
  });

  // ── delete diagram ──────────────────────────────────────────────────────

  describe("handleDeleteDiagram", () => {
    it("deletes an existing diagram", async () => {
      const diagramId = await createDiagram();
      const res = parseResult(
        await handleDeleteDiagram({ diagramId }),
      );
      expect(res.success).toBe(true);

      // Attempting to use the deleted diagram should fail
      await expect(
        handleExportXml({ diagramId }),
      ).rejects.toThrow(/Diagram not found/);
    });

    it("throws for unknown diagram", async () => {
      await expect(
        handleDeleteDiagram({ diagramId: "nope" }),
      ).rejects.toThrow(/Diagram not found/);
    });
  });

  // ── list diagrams ───────────────────────────────────────────────────────

  describe("handleListDiagrams", () => {
    it("lists all diagrams", async () => {
      await createDiagram("First");
      await createDiagram("Second");

      const res = parseResult(await handleListDiagrams());
      expect(res.count).toBe(2);
      expect(res.diagrams[0].name).toBe("First");
    });

    it("returns empty when no diagrams", async () => {
      const res = parseResult(await handleListDiagrams());
      expect(res.count).toBe(0);
    });
  });

  // ── clone diagram ───────────────────────────────────────────────────────

  describe("handleCloneDiagram", () => {
    it("creates a copy with a new ID", async () => {
      const diagramId = await createDiagram("Original");
      await addElement(diagramId, "bpmn:Task", { name: "My Task" });

      const res = parseResult(
        await handleCloneDiagram({ diagramId }),
      );
      expect(res.success).toBe(true);
      expect(res.diagramId).not.toBe(diagramId);
      expect(res.clonedFrom).toBe(diagramId);

      // Cloned diagram should have the same elements
      const origList = parseResult(
        await handleListElements({ diagramId }),
      );
      const cloneList = parseResult(
        await handleListElements({ diagramId: res.diagramId }),
      );
      expect(cloneList.count).toBe(origList.count);
    });

    it("allows overriding the name", async () => {
      const diagramId = await createDiagram("Original");
      const res = parseResult(
        await handleCloneDiagram({ diagramId, name: "Clone" }),
      );
      expect(res.name).toBe("Clone");
    });
  });

  // ── validate ────────────────────────────────────────────────────────────

  describe("handleValidate", () => {
    it("warns about missing start/end events on empty diagram", async () => {
      const diagramId = await createDiagram();
      const res = parseResult(await handleValidate({ diagramId }));
      expect(res.issues.some((i: any) => i.message.includes("start event"))).toBe(
        true,
      );
      expect(res.issues.some((i: any) => i.message.includes("end event"))).toBe(
        true,
      );
    });

    it("warns about disconnected elements", async () => {
      const diagramId = await createDiagram();
      await addElement(diagramId, "bpmn:Task", { name: "Lonely" });
      const res = parseResult(await handleValidate({ diagramId }));
      expect(
        res.issues.some((i: any) => i.message.includes("not connected") || i.rule === "no-disconnected"),
      ).toBe(true);
    });

    it("warns about unnamed tasks", async () => {
      const diagramId = await createDiagram();
      await addElement(diagramId, "bpmn:Task");
      const res = parseResult(await handleValidate({ diagramId }));
      expect(
        res.issues.some((i: any) => i.message.includes("missing label") || i.rule === "label-required"),
      ).toBe(true);
    });

    it("no start/end warnings when both present and connected", async () => {
      const diagramId = await createDiagram();
      const startId = await addElement(diagramId, "bpmn:StartEvent", {
        x: 100,
        y: 100,
      });
      const endId = await addElement(diagramId, "bpmn:EndEvent", {
        x: 300,
        y: 100,
      });
      await handleConnect({
        diagramId,
        sourceElementId: startId,
        targetElementId: endId,
      });

      const res = parseResult(await handleValidate({ diagramId }));
      expect(
        res.issues.some((i: any) => i.message.includes("No start event")),
      ).toBe(false);
      expect(
        res.issues.some((i: any) => i.message.includes("No end event")),
      ).toBe(false);
    });
  });

  // ── align elements ──────────────────────────────────────────────────────

  describe("handleAlignElements", () => {
    it("aligns elements to the left", async () => {
      const diagramId = await createDiagram();
      const aId = await addElement(diagramId, "bpmn:Task", {
        x: 100,
        y: 100,
      });
      const bId = await addElement(diagramId, "bpmn:Task", {
        x: 300,
        y: 200,
      });

      const res = parseResult(
        await handleAlignElements({
          diagramId,
          elementIds: [aId, bId],
          alignment: "left",
        }),
      );
      expect(res.success).toBe(true);
      expect(res.alignedCount).toBe(2);
    });

    it("throws with fewer than 2 elements", async () => {
      const diagramId = await createDiagram();
      const aId = await addElement(diagramId, "bpmn:Task", {
        x: 100,
        y: 100,
      });
      await expect(
        handleAlignElements({
          diagramId,
          elementIds: [aId],
          alignment: "top",
        }),
      ).rejects.toThrow(/at least 2/);
    });
  });

  // ── distribute elements ─────────────────────────────────────────────────

  describe("handleDistributeElements", () => {
    it("distributes elements horizontally", async () => {
      const diagramId = await createDiagram();
      const aId = await addElement(diagramId, "bpmn:Task", {
        x: 100,
        y: 100,
      });
      const bId = await addElement(diagramId, "bpmn:Task", {
        x: 200,
        y: 100,
      });
      const cId = await addElement(diagramId, "bpmn:Task", {
        x: 500,
        y: 100,
      });

      const res = parseResult(
        await handleDistributeElements({
          diagramId,
          elementIds: [aId, bId, cId],
          orientation: "horizontal",
        }),
      );
      expect(res.success).toBe(true);
      expect(res.distributedCount).toBe(3);
    });

    it("throws with fewer than 3 elements", async () => {
      const diagramId = await createDiagram();
      const aId = await addElement(diagramId, "bpmn:Task", {
        x: 100,
        y: 100,
      });
      const bId = await addElement(diagramId, "bpmn:Task", {
        x: 200,
        y: 100,
      });
      await expect(
        handleDistributeElements({
          diagramId,
          elementIds: [aId, bId],
          orientation: "horizontal",
        }),
      ).rejects.toThrow(/at least 3/);
    });
  });

  // ── set input/output mapping ────────────────────────────────────────────

  describe("handleSetInputOutput", () => {
    it("sets input/output parameters on a task", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "External",
      });

      const res = parseResult(
        await handleSetInputOutput({
          diagramId,
          elementId: taskId,
          inputParameters: [
            { name: "orderId", value: "123" },
            { name: "amount", value: "${order.total}" },
          ],
          outputParameters: [{ name: "result", value: "ok" }],
        }),
      );
      expect(res.success).toBe(true);
      expect(res.inputParameterCount).toBe(2);
      expect(res.outputParameterCount).toBe(1);

      // Verify it shows up in XML
      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("camunda:inputOutput");
      expect(xml).toContain("orderId");
    });

    it("works with get_element_properties", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "IO Task",
      });

      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [{ name: "var1", value: "val1" }],
      });

      const props = parseResult(
        await handleGetProperties({ diagramId, elementId: taskId }),
      );
      expect(props.extensionElements).toBeDefined();
      const io = props.extensionElements.find(
        (e: any) => e.type === "camunda:InputOutput",
      );
      expect(io).toBeDefined();
      expect(io.inputParameters[0].name).toBe("var1");
    });
  });

  // ── set event definition ────────────────────────────────────────────────

  describe("handleSetEventDefinition", () => {
    it("adds an error event definition to a boundary event", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "My Task",
        x: 200,
        y: 200,
      });
      const boundaryId = await addElement(diagramId, "bpmn:BoundaryEvent", {
        hostElementId: taskId,
        x: 220,
        y: 260,
      });

      const res = parseResult(
        await handleSetEventDefinition({
          diagramId,
          elementId: boundaryId,
          eventDefinitionType: "bpmn:ErrorEventDefinition",
          errorRef: {
            id: "Error_1",
            name: "BusinessError",
            errorCode: "ERR_001",
          },
        }),
      );
      expect(res.success).toBe(true);

      // Verify via XML
      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("errorEventDefinition");
    });

    it("adds a timer event definition", async () => {
      const diagramId = await createDiagram();
      const catchId = await addElement(
        diagramId,
        "bpmn:IntermediateCatchEvent",
        { x: 200, y: 200 },
      );

      const res = parseResult(
        await handleSetEventDefinition({
          diagramId,
          elementId: catchId,
          eventDefinitionType: "bpmn:TimerEventDefinition",
          properties: { timeDuration: "PT1H" },
        }),
      );
      expect(res.success).toBe(true);

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("timerEventDefinition");
    });

    it("throws for non-event element", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:Task", {
        name: "Not event",
      });

      await expect(
        handleSetEventDefinition({
          diagramId,
          elementId: taskId,
          eventDefinitionType: "bpmn:ErrorEventDefinition",
        }),
      ).rejects.toThrow(/not an event/);
    });
  });

  // ── Camunda 7 External Task integration ─────────────────────────────────

  describe("Camunda 7 External Task workflow", () => {
    it("creates a full external task with topic, I/O mapping, and boundary error", async () => {
      const diagramId = await createDiagram("External Task Process");

      // 1. Create service task with external task type
      const serviceTaskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "Process Order",
        x: 300,
        y: 200,
      });
      await handleSetProperties({
        diagramId,
        elementId: serviceTaskId,
        properties: {
          "camunda:type": "external",
          "camunda:topic": "order-processing",
        },
      });

      // 2. Set input/output mappings
      await handleSetInputOutput({
        diagramId,
        elementId: serviceTaskId,
        inputParameters: [
          { name: "orderId", value: "${execution.getVariable('orderId')}" },
        ],
        outputParameters: [{ name: "result", value: "${orderResult}" }],
      });

      // 3. Attach boundary error event
      const boundaryId = await addElement(diagramId, "bpmn:BoundaryEvent", {
        hostElementId: serviceTaskId,
        x: 320,
        y: 260,
      });
      await handleSetEventDefinition({
        diagramId,
        elementId: boundaryId,
        eventDefinitionType: "bpmn:ErrorEventDefinition",
        errorRef: {
          id: "Error_OrderFailed",
          name: "Order Failed",
          errorCode: "ORDER_ERR",
        },
      });

      // Verify the full XML
      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain('camunda:type="external"');
      expect(xml).toContain('camunda:topic="order-processing"');
      expect(xml).toContain("camunda:inputOutput");
      expect(xml).toContain("orderId");
      expect(xml).toContain("errorEventDefinition");
    });

    it("auto-sets camunda:type=external when only camunda:topic is provided", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "Auto External",
      });

      // Only set topic — type should be auto-set to "external"
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        properties: {
          "camunda:topic": "my-topic",
        },
      });

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain('camunda:type="external"');
      expect(xml).toContain('camunda:topic="my-topic"');
    });
  });

  // ── set_form_data ──────────────────────────────────────────────────────

  describe("handleSetFormData", () => {
    it("creates form data on a user task with basic fields", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:UserTask", {
        name: "Fill Form",
      });

      const res = parseResult(
        await handleSetFormData({
          diagramId,
          elementId: taskId,
          fields: [
            { id: "name", label: "Full Name", type: "string", defaultValue: "John" },
            { id: "age", label: "Age", type: "long" },
            { id: "active", label: "Is Active", type: "boolean", defaultValue: "true" },
          ],
        }),
      );
      expect(res.success).toBe(true);
      expect(res.fieldCount).toBe(3);

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("camunda:formData");
      expect(xml).toContain("camunda:formField");
      expect(xml).toContain('id="name"');
      expect(xml).toContain('label="Full Name"');
      expect(xml).toContain('defaultValue="John"');
    });

    it("supports enum fields with values", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:UserTask", {
        name: "Select",
      });

      const res = parseResult(
        await handleSetFormData({
          diagramId,
          elementId: taskId,
          fields: [
            {
              id: "priority",
              label: "Priority",
              type: "enum",
              values: [
                { id: "low", name: "Low" },
                { id: "high", name: "High" },
              ],
            },
          ],
        }),
      );
      expect(res.success).toBe(true);

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("camunda:value");
    });

    it("supports validation constraints", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:UserTask", {
        name: "Validated",
      });

      await handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [
          {
            id: "email",
            label: "Email",
            type: "string",
            validation: [
              { name: "required" },
              { name: "minlength", config: "5" },
            ],
          },
        ],
      });

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("camunda:validation");
      expect(xml).toContain("camunda:constraint");
      expect(xml).toContain("required");
      expect(xml).toContain("minlength");
    });

    it("supports businessKey", async () => {
      const diagramId = await createDiagram();
      const startId = await addElement(diagramId, "bpmn:StartEvent", {
        name: "Start",
      });

      const res = parseResult(
        await handleSetFormData({
          diagramId,
          elementId: startId,
          businessKey: "orderId",
          fields: [
            { id: "orderId", label: "Order ID", type: "string" },
          ],
        }),
      );
      expect(res.success).toBe(true);
      expect(res.businessKey).toBe("orderId");

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("camunda:formData");
    });

    it("throws for non-UserTask/StartEvent elements", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "Service",
      });

      await expect(
        handleSetFormData({
          diagramId,
          elementId: taskId,
          fields: [{ id: "f1", label: "F1", type: "string" }],
        }),
      ).rejects.toThrow(/only supported on/);
    });

    it("is visible via get_element_properties", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:UserTask", {
        name: "Props Test",
      });

      await handleSetFormData({
        diagramId,
        elementId: taskId,
        fields: [
          { id: "f1", label: "Field 1", type: "string", defaultValue: "abc" },
        ],
      });

      const props = parseResult(
        await handleGetProperties({ diagramId, elementId: taskId }),
      );
      expect(props.extensionElements).toBeDefined();
      const fd = props.extensionElements.find(
        (e: any) => e.type === "camunda:FormData",
      );
      expect(fd).toBeDefined();
      expect(fd.fields.length).toBe(1);
      expect(fd.fields[0].id).toBe("f1");
    });
  });

  // ── validate: camunda:topic without type=external ───────────────────────

  describe("handleValidate — external task validation", () => {
    it("warns when camunda:topic is set without camunda:type=external", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "Bad External",
      });
      // Manually set only topic without type (bypass auto-set by using type directly)
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        properties: {
          "camunda:type": "external",
          "camunda:topic": "my-topic",
        },
      });
      // Now change type to something else
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        properties: {
          "camunda:type": "connector",
        },
      });

      const res = parseResult(await handleValidate({ diagramId }));
      expect(
        res.issues.some((i: any) => i.message.includes("camunda:topic")),
      ).toBe(true);
    });
  });

  // ── input parameter value expressions ───────────────────────────────────

  describe("handleSetInputOutput — value expressions", () => {
    it("produces correct XML for expression values", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "Expr Test",
      });

      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [
          { name: "myInput", value: "${processVariable}" },
        ],
      });

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      // Should produce body text content, not a source attribute
      expect(xml).toContain("${processVariable}");
      expect(xml).not.toMatch(/source="/);
    });

    it("does not accept source or sourceExpression attributes", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "No Source",
      });

      // Even if someone passes source-like data as value, it should just set value
      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [
          { name: "var1", value: "static" },
        ],
      });

      const props = parseResult(
        await handleGetProperties({ diagramId, elementId: taskId }),
      );
      const io = props.extensionElements.find(
        (e: any) => e.type === "camunda:InputOutput",
      );
      expect(io.inputParameters[0].value).toBe("static");
    });
  });

  // ── meaningful process name/id on create ────────────────────────────────

  describe("handleCreateDiagram — meaningful process id", () => {
    it("sets a meaningful process id based on the name", async () => {
      const diagramId = await createDiagram("Order Fulfillment");
      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain('id="Process_Order_Fulfillment"');
      expect(xml).toContain("Order Fulfillment");
    });

    it("does not change process id when no name is provided", async () => {
      const diagramId = await createDiagram();
      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain('id="Process_1"');
    });
  });

  // ── descriptive element IDs ──────────────────────────────────────────────

  describe("descriptive element IDs", () => {
    it("generates a descriptive ID when name is provided", async () => {
      const diagramId = await createDiagram();
      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: "bpmn:UserTask",
          name: "Enter Name",
        }),
      );
      expect(res.elementId).toBe("UserTask_EnterName");
    });

    it("generates a descriptive ID for gateways", async () => {
      const diagramId = await createDiagram();
      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: "bpmn:ExclusiveGateway",
          name: "Has Surname?",
        }),
      );
      expect(res.elementId).toBe("Gateway_HasSurname");
    });

    it("falls back to default ID when no name is provided", async () => {
      const diagramId = await createDiagram();
      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: "bpmn:Task",
        }),
      );
      // Default IDs from bpmn-js contain Activity_ or similar
      expect(res.elementId).toBeDefined();
      expect(res.elementId).not.toBe("");
    });

    it("appends counter on ID collision", async () => {
      const diagramId = await createDiagram();
      const res1 = parseResult(
        await handleAddElement({
          diagramId,
          elementType: "bpmn:ServiceTask",
          name: "Process Order",
        }),
      );
      const res2 = parseResult(
        await handleAddElement({
          diagramId,
          elementType: "bpmn:ServiceTask",
          name: "Process Order",
        }),
      );
      expect(res1.elementId).toBe("ServiceTask_ProcessOrder");
      expect(res2.elementId).toBe("ServiceTask_ProcessOrder_2");
    });
  });

  // ── descriptive flow IDs ────────────────────────────────────────────────

  describe("descriptive flow IDs", () => {
    it("generates a flow ID from label", async () => {
      const diagramId = await createDiagram();
      const startId = await addElement(diagramId, "bpmn:StartEvent", {
        name: "Start",
        x: 100,
        y: 100,
      });
      const endId = await addElement(diagramId, "bpmn:EndEvent", {
        name: "End",
        x: 300,
        y: 100,
      });
      const conn = parseResult(
        await handleConnect({
          diagramId,
          sourceElementId: startId,
          targetElementId: endId,
          label: "done",
        }),
      );
      expect(conn.connectionId).toBe("Flow_Done");
    });

    it("generates a flow ID from source/target names when no label", async () => {
      const diagramId = await createDiagram();
      const startId = await addElement(diagramId, "bpmn:StartEvent", {
        name: "Begin",
        x: 100,
        y: 100,
      });
      const endId = await addElement(diagramId, "bpmn:EndEvent", {
        name: "Finish",
        x: 300,
        y: 100,
      });
      const conn = parseResult(
        await handleConnect({
          diagramId,
          sourceElementId: startId,
          targetElementId: endId,
        }),
      );
      expect(conn.connectionId).toBe("Flow_Begin_to_Finish");
    });
  });

  // ── gateway default flow ────────────────────────────────────────────────

  describe("gateway default flow", () => {
    it("set_element_properties supports default on exclusive gateways", async () => {
      const diagramId = await createDiagram();
      const gwId = await addElement(diagramId, "bpmn:ExclusiveGateway", {
        name: "Check",
        x: 200,
        y: 200,
      });
      const taskAId = await addElement(diagramId, "bpmn:Task", {
        name: "A",
        x: 400,
        y: 100,
      });
      const taskBId = await addElement(diagramId, "bpmn:Task", {
        name: "B",
        x: 400,
        y: 300,
      });

      const _connA = parseResult(
        await handleConnect({
          diagramId,
          sourceElementId: gwId,
          targetElementId: taskAId,
          conditionExpression: "${approved}",
        }),
      );
      const connB = parseResult(
        await handleConnect({
          diagramId,
          sourceElementId: gwId,
          targetElementId: taskBId,
        }),
      );

      // Set default flow via set_element_properties
      await handleSetProperties({
        diagramId,
        elementId: gwId,
        properties: { default: connB.connectionId },
      });

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("default=");
    });

    it("set_element_properties conditionExpression on sequence flow wraps in FormalExpression", async () => {
      const diagramId = await createDiagram();
      const gwId = await addElement(diagramId, "bpmn:ExclusiveGateway", {
        name: "Check",
        x: 200,
        y: 200,
      });
      const taskId = await addElement(diagramId, "bpmn:Task", {
        name: "Target",
        x: 400,
        y: 200,
      });
      const conn = parseResult(
        await handleConnect({
          diagramId,
          sourceElementId: gwId,
          targetElementId: taskId,
        }),
      );
      // Set conditionExpression via set_element_properties (string should be auto-wrapped)
      await handleSetProperties({
        diagramId,
        elementId: conn.connectionId,
        properties: { conditionExpression: "${approved == true}" },
      });
      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("${approved == true}");
      expect(xml).toContain("bpmn:conditionExpression");
    });

    it("connect_bpmn_elements isDefault flag sets the default flow", async () => {
      const diagramId = await createDiagram();
      const gwId = await addElement(diagramId, "bpmn:ExclusiveGateway", {
        name: "Route",
        x: 200,
        y: 200,
      });
      const taskId = await addElement(diagramId, "bpmn:Task", {
        name: "Default Path",
        x: 400,
        y: 200,
      });

      const conn = parseResult(
        await handleConnect({
          diagramId,
          sourceElementId: gwId,
          targetElementId: taskId,
          isDefault: true,
        }),
      );
      expect(conn.isDefault).toBe(true);

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("default=");
    });
  });

  // ── validate: gateway without default flow ──────────────────────────────

  describe("handleValidate — gateway default flow warning", () => {
    it("warns when exclusive gateway has conditional flows but no default", async () => {
      const diagramId = await createDiagram();
      const startId = await addElement(diagramId, "bpmn:StartEvent", {
        x: 100,
        y: 200,
      });
      const gwId = await addElement(diagramId, "bpmn:ExclusiveGateway", {
        name: "Check",
        x: 250,
        y: 200,
      });
      const taskAId = await addElement(diagramId, "bpmn:Task", {
        name: "Yes",
        x: 400,
        y: 100,
      });
      const taskBId = await addElement(diagramId, "bpmn:Task", {
        name: "No",
        x: 400,
        y: 300,
      });

      await handleConnect({
        diagramId,
        sourceElementId: startId,
        targetElementId: gwId,
      });
      await handleConnect({
        diagramId,
        sourceElementId: gwId,
        targetElementId: taskAId,
        conditionExpression: "${yes}",
      });
      await handleConnect({
        diagramId,
        sourceElementId: gwId,
        targetElementId: taskBId,
        conditionExpression: "${!yes}",
      });

      const res = parseResult(await handleValidate({ diagramId }));
      expect(
        res.issues.some((i: any) => i.message.includes("default flow")),
      ).toBe(true);
    });
  });

  // ── auto-layout ─────────────────────────────────────────────────────────

  // ── layout diagram ─────────────────────────────────────────────────────

  describe("handleLayoutDiagram", () => {
    it("runs layout on a diagram", async () => {
      const diagramId = await createDiagram("Composite Layout Test");
      const startId = await addElement(diagramId, "bpmn:StartEvent", {
        name: "Start",
        x: 100,
        y: 100,
      });
      const endId = await addElement(diagramId, "bpmn:EndEvent", {
        name: "End",
        x: 100,
        y: 100,
      });
      await handleConnect({
        diagramId,
        sourceElementId: startId,
        targetElementId: endId,
      });

      const res = parseResult(
        await handleLayoutDiagram({ diagramId }),
      );
      expect(res.success).toBe(true);
      expect(res.elementCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── smart add_bpmn_element insertion (shift downstream) ─────────────────

  describe("smart add_bpmn_element insertion", () => {
    it("shifts downstream elements when inserting via afterElementId", async () => {
      const diagramId = await createDiagram();
      const startId = await addElement(diagramId, "bpmn:StartEvent", {
        x: 100,
        y: 100,
      });
      const endId = await addElement(diagramId, "bpmn:EndEvent", {
        x: 300,
        y: 100,
      });

      // Insert a task between start and end
      await handleAddElement({
        diagramId,
        elementType: "bpmn:Task",
        name: "Middle Task",
        afterElementId: startId,
      });

      // End event should have been shifted to the right
      const list = parseResult(await handleListElements({ diagramId }));
      const endEl = list.elements.find((e: any) => e.id === endId);
      expect(endEl.x).toBeGreaterThan(300);
    });
  });

  // ── camunda ErrorEventDefinition on Service Tasks ───────────────────────

  describe("handleSetCamundaErrorEventDefinition", () => {
    it("sets camunda:ErrorEventDefinition on a service task", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "External Task",
      });

      const res = parseResult(
        await handleSetCamundaErrorEventDefinition({
          diagramId,
          elementId: taskId,
          errorDefinitions: [
            {
              id: "CamundaError_1",
              expression: '${error.code == "ERR_001"}',
              errorRef: {
                id: "Error_Biz",
                name: "Business Error",
                errorCode: "BIZ_ERR",
              },
            },
          ],
        }),
      );
      expect(res.success).toBe(true);
      expect(res.definitionCount).toBe(1);

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("camunda:errorEventDefinition");
    });

    it("throws for non-service-task element", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:UserTask", {
        name: "User Task",
      });

      await expect(
        handleSetCamundaErrorEventDefinition({
          diagramId,
          elementId: taskId,
          errorDefinitions: [{ id: "err1" }],
        }),
      ).rejects.toThrow(/only supported on/);
    });
  });

  // ── task markers (loop characteristics) ─────────────────────────────────

  describe("handleSetLoopCharacteristics", () => {
    it("sets parallel multi-instance on a task", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:UserTask", {
        name: "Review",
      });

      const res = parseResult(
        await handleSetLoopCharacteristics({
          diagramId,
          elementId: taskId,
          loopType: "parallel",
          loopCardinality: "3",
        }),
      );
      expect(res.success).toBe(true);
      expect(res.loopType).toBe("parallel");

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("multiInstanceLoopCharacteristics");
    });

    it("sets sequential multi-instance on a task", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "Batch",
      });

      const res = parseResult(
        await handleSetLoopCharacteristics({
          diagramId,
          elementId: taskId,
          loopType: "sequential",
          collection: "items",
          elementVariable: "item",
        }),
      );
      expect(res.success).toBe(true);

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain('isSequential="true"');
    });

    it("sets standard loop on a task", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:Task", {
        name: "Retry",
      });

      const res = parseResult(
        await handleSetLoopCharacteristics({
          diagramId,
          elementId: taskId,
          loopType: "standard",
          loopCondition: "${count < 10}",
        }),
      );
      expect(res.success).toBe(true);

      const xml = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml).toContain("standardLoopCharacteristics");
    });

    it("removes loop characteristics with loopType none", async () => {
      const diagramId = await createDiagram();
      const taskId = await addElement(diagramId, "bpmn:Task", {
        name: "Loop Then Remove",
      });

      await handleSetLoopCharacteristics({
        diagramId,
        elementId: taskId,
        loopType: "parallel",
      });
      const xml1 = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml1).toContain("multiInstanceLoopCharacteristics");

      await handleSetLoopCharacteristics({
        diagramId,
        elementId: taskId,
        loopType: "none",
      });
      const xml2 = (await handleExportXml({ diagramId })).content[0].text;
      expect(xml2).not.toContain("multiInstanceLoopCharacteristics");
    });

    it("throws for non-task element", async () => {
      const diagramId = await createDiagram();
      const eventId = await addElement(diagramId, "bpmn:StartEvent", {
        name: "Start",
      });

      await expect(
        handleSetLoopCharacteristics({
          diagramId,
          elementId: eventId,
          loopType: "parallel",
        }),
      ).rejects.toThrow(/tasks, subprocesses, or call activities/);
    });
  });

  // ── dispatch ────────────────────────────────────────────────────────────

  describe("dispatchToolCall", () => {
    it("routes create_bpmn_diagram correctly", async () => {
      const res = parseResult(
        await dispatchToolCall("create_bpmn_diagram", {}),
      );
      expect(res.success).toBe(true);
    });

    it("routes new tools correctly", async () => {
      const createRes = parseResult(
        await dispatchToolCall("create_bpmn_diagram", {}),
      );
      const diagramId = createRes.diagramId;

      // list_diagrams
      const listRes = parseResult(
        await dispatchToolCall("list_diagrams", {}),
      );
      expect(listRes.count).toBe(1);

      // validate_bpmn_diagram
      const validateRes = parseResult(
        await dispatchToolCall("validate_bpmn_diagram", { diagramId }),
      );
      expect(validateRes.issues).toBeDefined();

      // delete_diagram
      const deleteRes = parseResult(
        await dispatchToolCall("delete_diagram", { diagramId }),
      );
      expect(deleteRes.success).toBe(true);
    });

    it("throws for unknown tool", async () => {
      await expect(
        dispatchToolCall("no_such_tool", {}),
      ).rejects.toThrow(/Unknown tool/);
    });

    it("routes auto_layout backward alias to layout_diagram", async () => {
      const createRes = parseResult(
        await dispatchToolCall("create_bpmn_diagram", {}),
      );
      const diagramId = createRes.diagramId;
      const res = parseResult(
        await dispatchToolCall("auto_layout", { diagramId }),
      );
      expect(res.success).toBe(true);
      expect(res.elementCount).toBeDefined();
    });
  });
});
