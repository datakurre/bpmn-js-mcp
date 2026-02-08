import { describe, it, expect, beforeEach } from "vitest";
import { handleListElements, handleConnect } from "../../src/handlers";
import { parseResult, createDiagram, addElement, clearDiagrams } from "../helpers";

describe("handleListElements", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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
