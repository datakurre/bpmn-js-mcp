import { describe, it, expect, beforeEach } from "vitest";
import { handleSetCamundaErrorEventDefinition, handleExportXml } from "../../src/handlers";
import { parseResult, createDiagram, addElement, clearDiagrams } from "../helpers";

describe("handleSetCamundaErrorEventDefinition", () => {
  beforeEach(() => {
    clearDiagrams();
  });

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
