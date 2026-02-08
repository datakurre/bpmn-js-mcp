import { describe, it, expect, beforeEach } from "vitest";
import {
  generateDiagramId,
  getDiagram,
  storeDiagram,
  deleteDiagram,
  getAllDiagrams,
  clearDiagrams,
  createModeler,
  INITIAL_XML,
} from "../src/diagram-manager";
import type { DiagramState } from "../src/types";

describe("diagram-manager", () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe("generateDiagramId", () => {
    it("produces unique IDs", () => {
      const a = generateDiagramId();
      const b = generateDiagramId();
      expect(a).not.toBe(b);
    });

    it("starts with 'diagram_'", () => {
      expect(generateDiagramId()).toMatch(/^diagram_/);
    });
  });

  describe("store / get / delete / clear", () => {
    it("returns undefined for unknown IDs", () => {
      expect(getDiagram("nope")).toBeUndefined();
    });

    it("round-trips a stored diagram", () => {
      const state: DiagramState = {
        modeler: {} as any,
        xml: "<xml/>",
      };
      storeDiagram("d1", state);
      expect(getDiagram("d1")).toBe(state);
    });

    it("deleteDiagram removes a specific entry", () => {
      storeDiagram("d1", { modeler: {} as any, xml: "" });
      storeDiagram("d2", { modeler: {} as any, xml: "" });
      expect(deleteDiagram("d1")).toBe(true);
      expect(getDiagram("d1")).toBeUndefined();
      expect(getDiagram("d2")).toBeDefined();
    });

    it("deleteDiagram returns false for unknown ID", () => {
      expect(deleteDiagram("nope")).toBe(false);
    });

    it("clearDiagrams removes all entries", () => {
      storeDiagram("d1", { modeler: {} as any, xml: "" });
      clearDiagrams();
      expect(getDiagram("d1")).toBeUndefined();
    });
  });

  describe("getAllDiagrams", () => {
    it("returns the internal map", () => {
      storeDiagram("d1", { modeler: {} as any, xml: "" });
      storeDiagram("d2", { modeler: {} as any, xml: "" });
      const all = getAllDiagrams();
      expect(all.size).toBe(2);
      expect(all.has("d1")).toBe(true);
    });
  });

  describe("INITIAL_XML", () => {
    it("contains the camunda namespace", () => {
      expect(INITIAL_XML).toContain("xmlns:camunda");
    });

    it("is valid-ish BPMN (contains definitions)", () => {
      expect(INITIAL_XML).toContain("<bpmn:definitions");
      expect(INITIAL_XML).toContain("</bpmn:definitions>");
    });
  });

  describe("createModeler", () => {
    it("returns a modeler with elementRegistry service", async () => {
      const modeler = await createModeler();
      const registry = modeler.get("elementRegistry");
      expect(registry).toBeDefined();
    });

    it("initialised diagram contains a Process element", async () => {
      const modeler = await createModeler();
      const registry = modeler.get("elementRegistry");
      const processes = registry.filter(
        (el: any) => el.type === "bpmn:Process",
      );
      expect(processes.length).toBe(1);
    });
  });
});
