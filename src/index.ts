export type { DataProfile, DataProfileKey } from './spec/data-profile.js';
export { DATA_PROFILE_KEYS } from './spec/data-profile.js';
export type { Intent } from './spec/intent.js';
export { INTENTS } from './spec/intent.js';
export type {
  CatalogDataRole,
  CatalogEntry,
  CatalogEvalCase,
  CatalogRule,
  EngineCatalog,
} from './spec/engine-catalog.js';
export type { SpecAction, SpecTool, WorkspaceSpec } from './spec/workspace-spec.js';
export { SPEC_ACTIONS } from './spec/workspace-spec.js';
export type { ValidationCode, ValidationResult } from './validate/validate-spec.js';
export { VALIDATION_CODES, validateSpec } from './validate/validate-spec.js';
export type { EngineDecision, DecideInput } from './engine/types.js';
export { decide } from './engine/decide.js';
export type { Trace, TraceCandidate, TraceRejection } from './trace/trace.js';
export type { SignedLink, SignDataLink, ReadDataLink } from './tool/data-channel.js';
export { CALL_SERVER_TOOL, attachDataHandle, readViaHandle } from './tool/data-channel.js';
export type {
  ShowWorkspaceContext,
  ShowWorkspaceResult,
  ShowWorkspaceCode,
} from './tool/show-workspace.js';
export {
  SHOW_WORKSPACE_NAME,
  SHOW_WORKSPACE_DESCRIPTION,
  SHOW_WORKSPACE_INPUT_SCHEMA,
  SHOW_WORKSPACE_TOOL,
  handleShowWorkspace,
} from './tool/show-workspace.js';
export type {
  InterpretResult,
  LoadWorkspaceComponent,
  WorkspaceHost,
  WorkspaceMounter,
} from './interpreter/interpret.js';
export { interpretWorkspace } from './interpreter/interpret.js';
