import { describe, it, expect, beforeEach } from "vitest";
import { handleSetLoopCharacteristics, handleExportXml } from "../../src/handlers";
import { parseResult, createDiagram, addElement, clearDiagrams } from "../helpers";

describe("handleSetLoopCharacteristics", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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
