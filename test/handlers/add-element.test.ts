import { describe, it, expect, beforeEach } from "vitest";
import { handleAddElement, handleListElements } from "../../src/handlers";
import { parseResult, createDiagram, addElement, clearDiagrams } from "../helpers";

describe("handleAddElement", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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

describe("descriptive element IDs", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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

describe("smart add_bpmn_element insertion", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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
