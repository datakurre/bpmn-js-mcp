import { describe, it, expect, beforeEach } from "vitest";
import { handleConnect, handleSetProperties, handleExportXml } from "../../src/handlers";
import { parseResult, createDiagram, addElement, clearDiagrams } from "../helpers";

describe("gateway default flow", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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
