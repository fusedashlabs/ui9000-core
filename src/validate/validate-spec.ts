import type { CatalogEntry, EngineCatalog } from '../spec/engine-catalog.js';
import {
  SPEC_ACTION_SET,
  type SpecBindItem,
  type WorkspaceSpec,
} from '../spec/workspace-spec.js';
import { fail, type ValidationResult } from './codes.js';

export type { ValidationCode, ValidationFail, ValidationOk, ValidationResult } from './codes.js';
export { VALIDATION_CODES } from './codes.js';

const HANDLER_KEYS = new Set([
  'onclick',
  'onchange',
  'onsubmit',
  'onload',
  'onerror',
  'onmouseover',
  'onfocus',
  'onblur',
  'oninput',
  'onkeydown',
  'onkeyup',
  'handler',
]);

const FIELD_DEF_KEYS = new Set(['name', 'id', 'label', 'type', 'required']);

const HANDLER_SOURCE = /^(?:function\b|\([^)]*\)\s*=>)/;
/** Scheme, not the word "javascript". Also matches url(javascript:…). */
const JAVASCRIPT_SCHEME = /(?:^|[^a-z0-9_+.-])javascript\s*:/i;
/** data: URLs only — not prose like "Compare data: production". */
const DATA_URL = /(?:^|[^a-z0-9_+.-])data\s*:(?:[a-z]+\/[a-z0-9.+-]+|,)/i;

export function validateSpec(
  spec: unknown,
  catalog: EngineCatalog,
): ValidationResult<WorkspaceSpec> {
  return validateNode(spec, catalog, byId(catalog));
}

function validateNode(
  spec: unknown,
  catalog: EngineCatalog,
  index: Map<string, CatalogEntry>,
): ValidationResult<WorkspaceSpec> {
  const schema = layerSchema(spec);
  if (!schema.ok) return schema;
  const node = schema.spec;

  const safety = layerSafety(node);
  if (!safety.ok) return safety;

  const listed = index.get(node.component);
  if (!listed) {
    return fail('unknown_component', `component "${node.component}" is not in the engine catalog`);
  }

  const dataA11y = layerDataA11y(node, listed);
  if (!dataA11y.ok) return dataA11y;

  for (const child of node.children ?? []) {
    const nested = validateNode(child, catalog, index);
    if (!nested.ok) return nested;
  }

  return { ok: true, spec: node };
}

function layerSchema(spec: unknown): ValidationResult<WorkspaceSpec> {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return fail('unknown_component', 'spec must be an object');
  }

  const raw = spec as Record<string, unknown>;
  if (typeof raw.component !== 'string' || raw.component.trim() === '') {
    return fail('unknown_component', 'spec.component must be a non-empty string');
  }

  if (raw.props !== undefined && !isPlainObject(raw.props)) {
    return fail('unknown_component', 'spec.props must be an object');
  }

  if (raw.binds !== undefined && !isPlainObject(raw.binds) && !Array.isArray(raw.binds)) {
    return fail('missing_bound_field', 'spec.binds must be an object or array');
  }

  if (raw.tools !== undefined && !Array.isArray(raw.tools)) {
    return fail('unnamed_tool', 'spec.tools must be an array');
  }

  if (raw.allowedActions !== undefined && !Array.isArray(raw.allowedActions)) {
    return fail('unknown_action', 'spec.allowedActions must be an array');
  }

  if (raw.actions !== undefined && !Array.isArray(raw.actions)) {
    return fail('unknown_action', 'spec.actions must be an array');
  }

  if (raw.children !== undefined && !Array.isArray(raw.children)) {
    return fail('unknown_component', 'spec.children must be an array');
  }

  if (raw.fields !== undefined && !Array.isArray(raw.fields)) {
    return fail('missing_bound_field', 'spec.fields must be an array');
  }

  if (hasRowPayload(raw)) {
    return fail('unmet_data', 'spec must not include data rows; use binds and a data handle');
  }

  return { ok: true, spec: raw as WorkspaceSpec };
}

function layerSafety(spec: WorkspaceSpec): ValidationResult<WorkspaceSpec> {
  const seen = new WeakSet<object>();
  const queue: unknown[] = [spec];

  while (queue.length > 0) {
    const value = queue.pop();
    if (typeof value === 'function') {
      return fail('handler_prop', 'functions are not allowed on the spec');
    }
    if (typeof value === 'string') {
      if (JAVASCRIPT_SCHEME.test(value)) {
        return fail('javascript_url', 'javascript: URLs are refused');
      }
      if (DATA_URL.test(value)) {
        return fail('data_url', 'data: URLs are refused');
      }
      if (HANDLER_SOURCE.test(value.trim())) {
        return fail('handler_prop', 'handler source is not allowed on the spec');
      }
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }

    for (const [key, child] of Object.entries(value)) {
      if (isHandlerKey(key)) {
        return fail('handler_prop', `prop "${key}" is a handler and is refused`);
      }
      if (key === 'children') continue;
      queue.push(child);
    }
  }

  return { ok: true, spec };
}

function layerDataA11y(
  spec: WorkspaceSpec,
  entry: CatalogEntry,
): ValidationResult<WorkspaceSpec> {
  const actions = declaredActions(spec);
  for (const action of actions) {
    if (!SPEC_ACTION_SET.has(action)) {
      return fail(
        'unknown_action',
        `action "${action}" is not in hover|resize|select|submit|approve|reject`,
      );
    }
  }

  for (const tool of spec.tools ?? []) {
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string' || tool.name.trim() === '') {
      return fail('unnamed_tool', 'every tool must have a non-empty name');
    }
  }

  const binds = collectBinds(spec);
  const roles = new Map((entry.dataRoles ?? []).map((role) => [role.id, role]));
  const fields = declaredFieldNames(spec);

  for (const bind of binds) {
    if (!bind.field) {
      return fail('missing_bound_field', `bind "${bind.role}" has no field`);
    }
    if (roles.size > 0 && !roles.has(bind.role)) {
      return fail('missing_bound_field', `bind role "${bind.role}" is not a catalog data role`);
    }
    if (fields && !fields.has(bind.field)) {
      return fail('missing_bound_field', `bind field "${bind.field}" is not a declared field`);
    }
  }

  for (const role of entry.dataRoles ?? []) {
    if (!role.required) continue;
    if (role.id === 'fields' && satisfiesFieldsRole(spec)) continue;
    if (binds.some((bind) => bind.role === role.id)) continue;
    return fail('unmet_data', `required data role "${role.id}" is not bound`);
  }

  if (needsLabel(entry) && !controlLabel(spec)) {
    return fail('unlabelled_control', `component "${entry.id}" requires a label`);
  }

  for (const item of fieldObjects(spec)) {
    const label = stringProp(item, 'label');
    if (!label) {
      return fail('unlabelled_control', 'every control field must have a label');
    }
  }

  return { ok: true, spec };
}

function byId(catalog: EngineCatalog): Map<string, CatalogEntry> {
  const index = new Map<string, CatalogEntry>();
  if (!Array.isArray(catalog)) return index;
  for (const entry of catalog) {
    if (entry && typeof entry.id === 'string') index.set(entry.id, entry);
  }
  return index;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHandlerKey(key: string): boolean {
  if (HANDLER_KEYS.has(key.toLowerCase())) return true;
  if (key.endsWith('Handler')) return true;
  return /^on[A-Z]/.test(key);
}

function hasRowPayload(raw: Record<string, unknown>): boolean {
  if (isRowArray(raw.data)) return true;
  if (isPlainObject(raw.props) && isRowArray(raw.props.data)) return true;
  return false;
}

function isRowArray(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.some((item) => isPlainObject(item) && !isFieldDef(item));
}

function isFieldDef(item: Record<string, unknown>): boolean {
  const keys = Object.keys(item);
  return keys.length > 0 && keys.every((key) => FIELD_DEF_KEYS.has(key));
}

function declaredActions(spec: WorkspaceSpec): string[] {
  const listed = spec.allowedActions ?? spec.actions ?? [];
  return listed.filter((action): action is string => typeof action === 'string');
}

function collectBinds(spec: WorkspaceSpec): SpecBindItem[] {
  const binds = spec.binds;
  if (!binds) return [];
  if (Array.isArray(binds)) {
    return binds
      .filter((item): item is SpecBindItem => isPlainObject(item) && typeof item.role === 'string')
      .map((item) => ({
        role: item.role,
        field: typeof item.field === 'string' ? item.field : '',
      }));
  }
  return Object.entries(binds).map(([role, value]) => {
    if (typeof value === 'string') return { role, field: value };
    if (isPlainObject(value) && typeof value.field === 'string') {
      return { role, field: value.field };
    }
    return { role, field: '' };
  });
}

function declaredFieldNames(spec: WorkspaceSpec): Set<string> | null {
  const raw =
    spec.fields ??
    (isPlainObject(spec.props) ? spec.props.fields : undefined) ??
    nestedFields(spec.props);
  if (!Array.isArray(raw)) return null;
  const names = raw
    .map((item) => {
      if (typeof item === 'string') return item;
      if (isPlainObject(item)) {
        if (typeof item.name === 'string') return item.name;
        if (typeof item.id === 'string') return item.id;
      }
      return '';
    })
    .filter((name) => name !== '');
  return new Set(names);
}

function nestedFields(props: Record<string, unknown> | undefined): unknown {
  if (!isPlainObject(props) || !isPlainObject(props.data)) return undefined;
  return props.data.fields;
}

function satisfiesFieldsRole(spec: WorkspaceSpec): boolean {
  if ((spec.children?.length ?? 0) > 0) return true;
  const fields = declaredFieldNames(spec);
  return fields !== null && fields.size > 0;
}

function needsLabel(entry: CatalogEntry): boolean {
  const from = entry.accessibility?.nameFrom;
  return from === 'label' || from === 'form label';
}

function controlLabel(spec: WorkspaceSpec): string | undefined {
  return (
    stringProp(spec, 'label') ||
    (isPlainObject(spec.props) ? stringProp(spec.props, 'label') : undefined) ||
    (isPlainObject(spec.props) ? stringProp(spec.props, 'aria-label') : undefined) ||
    (isPlainObject(spec.props) ? stringProp(spec.props, 'ariaLabel') : undefined) ||
    (isPlainObject(spec.props) && isPlainObject(spec.props.data)
      ? stringProp(spec.props.data, 'label')
      : undefined)
  );
}

function fieldObjects(spec: WorkspaceSpec): Record<string, unknown>[] {
  const raw =
    spec.fields ??
    (isPlainObject(spec.props) ? spec.props.fields : undefined) ??
    nestedFields(spec.props);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => isPlainObject(item) && isFieldDef(item));
}

function stringProp(obj: object, key: string): string | undefined {
  const value = (obj as Record<string, unknown>)[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
