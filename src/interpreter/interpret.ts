import type { EngineCatalog } from '../spec/engine-catalog.js';
import type { WorkspaceSpec } from '../spec/workspace-spec.js';
import { validateSpec, type ValidationCode } from '../validate/validate-spec.js';

export type WorkspaceHost = {
  replaceChildren: (...nodes: unknown[]) => void;
};

export type WorkspaceMounter = {
  mount: (host: WorkspaceHost, spec: WorkspaceSpec) => void | Promise<void>;
};

export type LoadWorkspaceComponent = (
  id: string,
) => Promise<WorkspaceMounter | undefined>;

export type InterpretRefuse = {
  mounted: false;
  code: ValidationCode | 'invalid_result';
  reason: string;
};

export type InterpretMounted = {
  mounted: true;
  spec: WorkspaceSpec;
};

export type InterpretResult = InterpretRefuse | InterpretMounted;

/**
 * Validate then mount. Hostile specs never reach load() or the host.
 * Mount is a catalog loader on a known id — not host markup or element registry APIs.
 */
export async function interpretWorkspace(
  toolResult: unknown,
  catalog: EngineCatalog,
  load: LoadWorkspaceComponent,
  host: WorkspaceHost,
): Promise<InterpretResult> {
  const raw = extractSpec(toolResult);
  if (raw === undefined) {
    return {
      mounted: false,
      code: 'invalid_result',
      reason: 'tool result has no workspace spec',
    };
  }

  const validated = validateSpec(raw, catalog);
  if (!validated.ok) {
    return { mounted: false, code: validated.code, reason: validated.reason };
  }

  const mounter = await load(validated.spec.component);
  if (!mounter || typeof mounter.mount !== 'function') {
    return {
      mounted: false,
      code: 'unknown_component',
      reason: `no mounter registered for "${validated.spec.component}"`,
    };
  }

  host.replaceChildren();
  await mounter.mount(host, validated.spec);
  return { mounted: true, spec: validated.spec };
}

function extractSpec(toolResult: unknown): unknown {
  if (!isPlain(toolResult)) return undefined;
  if ('spec' in toolResult) return toolResult.spec;
  if (isPlain(toolResult.structuredContent) && 'spec' in toolResult.structuredContent) {
    return toolResult.structuredContent.spec;
  }
  if (isPlain(toolResult._meta) && 'spec' in toolResult._meta) {
    return toolResult._meta.spec;
  }
  if (typeof toolResult.component === 'string') return toolResult;
  return undefined;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
