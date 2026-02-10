/**
 * Scoped export: export a subprocess or participant as a standalone diagram.
 *
 * Split from export.ts for file-size compliance.
 */

import { type ToolResult } from '../types';
import { requireElement } from './helpers';
import { createModelerFromXml } from '../diagram-manager';

/**
 * Handle export scoped to a single subprocess or participant.
 */
export async function handleScopedExport(
  diagram: any,
  elementId: string,
  format: string
): Promise<ToolResult> {
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const element = requireElement(elementRegistry, elementId);

  const elType = element.type || element.businessObject?.$type || '';
  if (!elType.includes('SubProcess') && !elType.includes('Participant')) {
    return {
      content: [
        {
          type: 'text',
          text: `Element ${elementId} is not a SubProcess or Participant (type: ${elType}). Only these types can be exported as standalone diagrams.`,
        },
      ],
    };
  }

  const bo = element.businessObject;
  const moddle = diagram.modeler.get('moddle');

  let processBO: any;
  if (elType.includes('Participant')) {
    processBO = bo.processRef;
  } else {
    processBO = bo;
  }

  if (!processBO) {
    return {
      content: [{ type: 'text', text: `Could not extract process from element ${elementId}.` }],
    };
  }

  const flowElements = processBO.flowElements || [];
  if (flowElements.length === 0 && !elType.includes('Participant')) {
    return {
      content: [{ type: 'text', text: `SubProcess ${elementId} has no flow elements to export.` }],
    };
  }

  const { xml: fullXml } = await diagram.modeler.saveXML({ format: true });

  return exportSubprocessContent({
    moddle,
    processBO,
    elementId,
    format,
    fullXml: fullXml || '',
  });
}

async function exportSubprocessContent(opts: {
  moddle: any;
  processBO: any;
  elementId: string;
  format: string;
  fullXml: string;
}): Promise<ToolResult> {
  const { moddle, processBO, elementId, format, fullXml } = opts;
  try {
    const newProcess = moddle.create('bpmn:Process', {
      id: `Process_${elementId}`,
      isExecutable: true,
      flowElements: [...(processBO.flowElements || [])],
    });

    const exportDefs = moddle.create('bpmn:Definitions', {
      id: 'Definitions_export',
      targetNamespace: 'http://bpmn.io/schema/bpmn',
      rootElements: [newProcess],
    });
    newProcess.$parent = exportDefs;

    const { xml: exportXml } = await moddle.toXML(exportDefs, { format: true });

    if (format === 'svg') {
      try {
        const tempModeler = await createModelerFromXml(exportXml);
        const { svg } = await tempModeler.saveSVG();
        return { content: [{ type: 'text', text: svg || '' }] };
      } catch {
        return {
          content: [
            { type: 'text', text: exportXml },
            { type: 'text', text: '\n⚠ SVG export of subprocess failed; returning XML instead.' },
          ],
        };
      }
    }

    return { content: [{ type: 'text', text: exportXml }] };
  } catch {
    return {
      content: [
        { type: 'text', text: fullXml },
        {
          type: 'text',
          text: `\n⚠ Partial export fallback: full diagram XML returned for ${elementId}.`,
        },
      ],
    };
  }
}
