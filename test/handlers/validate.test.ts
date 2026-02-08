import { describe, it, expect, beforeEach } from "vitest";
import { handleValidate, handleConnect, handleSetProperties } from "../../src/handlers";
import { parseResult, createDiagram, addElement, clearDiagrams } from "../helpers";

describe("handleValidate", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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

describe("handleValidate — external task validation", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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

describe("handleValidate — gateway default flow warning", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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
