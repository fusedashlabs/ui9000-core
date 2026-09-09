/** Closed action types a spec may declare. Catalog metadata may list more. */
export const SPEC_ACTIONS = [
  'hover',
  'resize',
  'select',
  'submit',
  'approve',
  'reject',
] as const;

export type SpecAction = (typeof SPEC_ACTIONS)[number];

export const SPEC_ACTION_SET: ReadonlySet<string> = new Set(SPEC_ACTIONS);

export type SpecBindValue = string | { field: string };

export type SpecBindMap = Record<string, SpecBindValue>;

export type SpecBindItem = {
  role: string;
  field: string;
};

export type SpecTool = {
  name: string;
};

export type SpecField = string | { name?: string; id?: string; label?: string };

/**
 * Workspace spec. No `data: row[]` — rows arrive through the data-channel handle.
 */
export type WorkspaceSpec = {
  component: string;
  props?: Record<string, unknown>;
  binds?: SpecBindMap | readonly SpecBindItem[];
  fields?: readonly SpecField[];
  allowedActions?: readonly string[];
  actions?: readonly string[];
  tools?: readonly { name?: string; [key: string]: unknown }[];
  children?: readonly unknown[];
  label?: string;
};
