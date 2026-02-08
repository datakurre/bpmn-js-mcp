import { describe, it, expect, beforeEach } from "vitest";
import { handleLayoutDiagram, handleConnect } from "../../src/handlers";
import { parseResult, createDiagram, addElement, clearDiagrams } from "../helpers";

describe("handleLayoutDiagram", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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
