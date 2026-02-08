import { describe, it, expect, beforeEach } from "vitest";
import { handleGetProperties, handleSetProperties, handleConnect } from "../../src/handlers";
import { parseResult, createDiagram, addElement, clearDiagrams } from "../helpers";

describe("handleGetProperties", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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
