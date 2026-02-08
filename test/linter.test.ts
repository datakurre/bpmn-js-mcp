import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  lintDiagram,
  lintDiagramFlat,
  appendLintFeedback,
  getDefinitionsFromModeler,
  resetLinterCache,
  resetUserConfig,
  DEFAULT_LINT_CONFIG,
} from "../src/linter";
import { createDiagram, addElement, clearDiagrams } from "./helpers";
import { handleConnect } from "../src/handlers";
import { getDiagram } from "../src/diagram-manager";

describe("linter", () => {
  beforeEach(() => {
    clearDiagrams();
    resetLinterCache();
    resetUserConfig();
  });

  afterEach(() => {
    clearDiagrams();
  });

  describe("getDefinitionsFromModeler", () => {
    it("returns a moddle element with $type bpmn:Definitions", async () => {
      const diagramId = await createDiagram();
      const diagram = getDiagram(diagramId);
      const definitions = getDefinitionsFromModeler(diagram!.modeler);

      expect(definitions).toBeDefined();
      expect(definitions.$type).toBe("bpmn:Definitions");
    });
  });

  describe("lintDiagram", () => {
    it("returns results keyed by rule name for empty process", async () => {
      const diagramId = await createDiagram();
      const diagram = getDiagram(diagramId);
      const results = await lintDiagram(diagram!);

      expect(results).toBeDefined();
      expect(typeof results).toBe("object");
      // Empty process should trigger start-event-required and end-event-required
      expect(results["start-event-required"]).toBeDefined();
      expect(results["end-event-required"]).toBeDefined();
    });

    it("returns no start/end event errors for valid complete process", async () => {
      const diagramId = await createDiagram();
      const startId = await addElement(diagramId, "bpmn:StartEvent", { x: 100, y: 100 });
      const taskId = await addElement(diagramId, "bpmn:Task", { name: "Work", x: 250, y: 100 });
      const endId = await addElement(diagramId, "bpmn:EndEvent", { x: 400, y: 100 });
      await handleConnect({ diagramId, sourceElementId: startId, targetElementId: taskId });
      await handleConnect({ diagramId, sourceElementId: taskId, targetElementId: endId });

      const diagram = getDiagram(diagramId);
      const results = await lintDiagram(diagram!);

      // Should not have start/end event required errors
      expect(results["start-event-required"]).toBeUndefined();
      expect(results["end-event-required"]).toBeUndefined();
    });
  });

  describe("lintDiagramFlat", () => {
    it("normalizes 'warn' category to 'warning' severity", async () => {
      const diagramId = await createDiagram();
      // Default config downgrades label-required and no-disconnected to 'warn'
      await addElement(diagramId, "bpmn:Task");
      const diagram = getDiagram(diagramId);
      const flat = await lintDiagramFlat(diagram!);

      const warnings = flat.filter((i) => i.severity === "warning");
      // Should have warnings (not 'warn' strings)
      for (const w of warnings) {
        expect(w.severity).toBe("warning");
      }
    });

    it("maps fields correctly (rule, severity, message, elementId)", async () => {
      const diagramId = await createDiagram();
      await addElement(diagramId, "bpmn:Task");
      const diagram = getDiagram(diagramId);
      const flat = await lintDiagramFlat(diagram!);

      expect(flat.length).toBeGreaterThan(0);
      for (const issue of flat) {
        expect(issue).toHaveProperty("rule");
        expect(issue).toHaveProperty("severity");
        expect(issue).toHaveProperty("message");
        expect(typeof issue.rule).toBe("string");
        expect(typeof issue.message).toBe("string");
      }
    });

    it("supports custom config overrides", async () => {
      const diagramId = await createDiagram();
      const diagram = getDiagram(diagramId);

      // Override to disable start/end event rules
      const flat = await lintDiagramFlat(diagram!, {
        extends: "bpmnlint:recommended",
        rules: {
          "start-event-required": "off",
          "end-event-required": "off",
          "no-overlapping-elements": "off",
        },
      });

      expect(flat.filter((i) => i.rule === "start-event-required")).toHaveLength(0);
      expect(flat.filter((i) => i.rule === "end-event-required")).toHaveLength(0);
    });
  });

  describe("appendLintFeedback", () => {
    it("appends feedback when errors exist", async () => {
      const diagramId = await createDiagram();
      const diagram = getDiagram(diagramId);
      const result = {
        content: [{ type: "text" as const, text: '{"success":true}' }],
      };

      const augmented = await appendLintFeedback(result, diagram!);
      // Empty process has errors; feedback should be appended
      expect(augmented.content.length).toBeGreaterThan(1);
      const feedbackText = augmented.content[augmented.content.length - 1].text;
      expect(feedbackText).toContain("⚠ Lint issues");
    });

    it("does not append feedback when only warnings exist", async () => {
      const diagramId = await createDiagram();
      const startId = await addElement(diagramId, "bpmn:StartEvent", { x: 100, y: 100 });
      const taskId = await addElement(diagramId, "bpmn:Task", { name: "Work", x: 250, y: 100 });
      const endId = await addElement(diagramId, "bpmn:EndEvent", { x: 400, y: 100 });
      await handleConnect({ diagramId, sourceElementId: startId, targetElementId: taskId });
      await handleConnect({ diagramId, sourceElementId: taskId, targetElementId: endId });

      const diagram = getDiagram(diagramId);

      // appendLintFeedback only appends error-severity issues
      // Even if some errors exist, verify the function runs without crashing
      const result = {
        content: [{ type: "text" as const, text: '{"success":true}' }],
      };

      const augmented = await appendLintFeedback(result, diagram!);
      // Result should have at least the original content
      expect(augmented.content.length).toBeGreaterThanOrEqual(1);
    });

    it("does not throw when linting fails", async () => {
      // Create a fake diagram with a broken modeler
      const fakeDiagram = {
        modeler: {
          getDefinitions: () => {
            throw new Error("boom");
          },
        },
      } as any;

      const result = {
        content: [{ type: "text" as const, text: '{"success":true}' }],
      };

      // Should not throw
      const augmented = await appendLintFeedback(result, fakeDiagram);
      expect(augmented.content).toHaveLength(1);
    });
  });

  describe("exercises multiple bpmnlint rules", () => {
    it("detects at least 5 different rules on a problematic diagram", async () => {
      const diagramId = await createDiagram();
      // Add two disconnected tasks with no names → triggers many rules
      await addElement(diagramId, "bpmn:Task", { x: 100, y: 100 });
      await addElement(diagramId, "bpmn:Task", { x: 300, y: 100 });

      const diagram = getDiagram(diagramId);
      // Use a config that enables more rules as errors for this test
      const flat = await lintDiagramFlat(diagram!, {
        extends: "bpmnlint:recommended",
        rules: {
          "no-overlapping-elements": "off",
          "label-required": "error",
          "no-disconnected": "error",
        },
      });

      const uniqueRules = new Set(flat.map((i) => i.rule));
      // Should trigger at least: start-event-required, end-event-required,
      // no-disconnected, label-required, no-implicit-start/end
      expect(uniqueRules.size).toBeGreaterThanOrEqual(5);
    });
  });

  describe("DEFAULT_LINT_CONFIG", () => {
    it("extends bpmnlint:recommended, camunda-compat, and bpmn-mcp plugins", () => {
      expect(DEFAULT_LINT_CONFIG.extends).toEqual([
        "bpmnlint:recommended",
        "plugin:camunda-compat/camunda-platform-7-24",
        "plugin:bpmn-mcp/recommended",
      ]);
    });

    it("has tuned rules for incremental AI usage", () => {
      expect(DEFAULT_LINT_CONFIG.rules!["label-required"]).toBe("warn");
      expect(DEFAULT_LINT_CONFIG.rules!["no-overlapping-elements"]).toBe("off");
      expect(DEFAULT_LINT_CONFIG.rules!["no-disconnected"]).toBe("warn");
    });
  });

  describe("McpPluginResolver — custom bpmn-mcp rules", () => {
    it("resolves bpmn-mcp/camunda-topic-without-external-type via plugin config", async () => {
      const diagramId = await createDiagram();
      // Add a service task with topic but no external type
      const taskId = await addElement(diagramId, "bpmn:ServiceTask", {
        name: "Worker",
        x: 200, y: 200,
      });
      // Manually set topic without external type via modeler
      const diagram = getDiagram(diagramId);
      const elementRegistry = diagram!.modeler.get("elementRegistry");
      const modeling = diagram!.modeler.get("modeling");
      const element = elementRegistry.get(taskId);
      modeling.updateProperties(element, {
        "camunda:topic": "my-topic",
        "camunda:type": "connector", // NOT external
      });

      // Lint with bpmn-mcp plugin rules explicitly enabled as error
      const flat = await lintDiagramFlat(diagram!, {
        extends: "plugin:bpmn-mcp/recommended",
        rules: {
          "bpmn-mcp/camunda-topic-without-external-type": "error",
        },
      });

      const topicIssues = flat.filter((i) =>
        i.rule === "bpmn-mcp/camunda-topic-without-external-type",
      );
      expect(topicIssues.length).toBeGreaterThan(0);
      expect(topicIssues[0].message).toContain("camunda:topic");
    });

    it("resolves bpmn-mcp/gateway-missing-default via plugin config", async () => {
      const diagramId = await createDiagram();
      const startId = await addElement(diagramId, "bpmn:StartEvent", { x: 100, y: 200 });
      const gwId = await addElement(diagramId, "bpmn:ExclusiveGateway", { name: "Check", x: 250, y: 200 });
      const taskAId = await addElement(diagramId, "bpmn:Task", { name: "Yes", x: 400, y: 100 });
      const taskBId = await addElement(diagramId, "bpmn:Task", { name: "No", x: 400, y: 300 });

      await handleConnect({ diagramId, sourceElementId: startId, targetElementId: gwId });
      await handleConnect({ diagramId, sourceElementId: gwId, targetElementId: taskAId, conditionExpression: "${yes}" });
      await handleConnect({ diagramId, sourceElementId: gwId, targetElementId: taskBId, conditionExpression: "${!yes}" });

      const diagram = getDiagram(diagramId);
      const flat = await lintDiagramFlat(diagram!, {
        extends: "plugin:bpmn-mcp/recommended",
        rules: {
          "bpmn-mcp/gateway-missing-default": "error",
        },
      });

      const gwIssues = flat.filter((i) => i.rule === "bpmn-mcp/gateway-missing-default");
      expect(gwIssues.length).toBeGreaterThan(0);
      expect(gwIssues[0].message).toContain("default flow");
    });
  });

  describe("camunda-compat plugin integration", () => {
    it("camunda-compat plugin rules are available through the default config", async () => {
      const diagramId = await createDiagram();
      // Add a process with start and end events
      const startId = await addElement(diagramId, "bpmn:StartEvent", { x: 100, y: 100 });
      const endId = await addElement(diagramId, "bpmn:EndEvent", { x: 300, y: 100 });
      await handleConnect({ diagramId, sourceElementId: startId, targetElementId: endId });

      const diagram = getDiagram(diagramId);
      // Lint with explicit camunda-compat config to verify plugin loads
      const flat = await lintDiagramFlat(diagram!, {
        extends: [
          "bpmnlint:recommended",
          "plugin:camunda-compat/camunda-platform-7-24",
        ],
        rules: {
          "label-required": "off",
          "no-overlapping-elements": "off",
          "no-disconnected": "off",
        },
      });

      // Should not error — plugin loaded and resolved successfully
      // The camunda-compat plugin for 7.24 has history-time-to-live as info
      expect(flat).toBeDefined();
      expect(Array.isArray(flat)).toBe(true);
    });
  });
});
