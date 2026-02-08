import { describe, it, expect, beforeEach } from "vitest";
import { handleConnect } from "../../src/handlers";
import { parseResult, createDiagram, addElement, clearDiagrams } from "../helpers";

describe("handleConnect", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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

describe("descriptive flow IDs", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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
