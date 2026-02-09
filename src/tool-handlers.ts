/**
 * Re-export barrel for backward compatibility.
 *
 * All handler implementations now live in individual modules under
 * src/handlers/.  This file simply re-exports everything so that
 * existing imports (e.g. from tests and index.ts) continue to work.
 */

export {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleDeleteElement,
  handleMoveElement,
  handleGetProperties,
  handleExportBpmn,
  handleListElements,
  handleSetProperties,
  handleImportXml,
  handleDeleteDiagram,
  handleListDiagrams,
  handleCloneDiagram,
  handleValidate,
  handleAlignElements,
  handleDistributeElements,
  handleSetInputOutput,
  handleSetEventDefinition,
  handleSetFormData,
  handleLayoutDiagram,
  handleSetCamundaErrorEventDefinition,
  handleSetLoopCharacteristics,
  handleAutoConnect,
  handleDuplicateElement,
  handleMoveToLane,
  dispatchToolCall,
} from './handlers/index';
