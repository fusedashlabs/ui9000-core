export const VALIDATION_CODES = [
  'unknown_component',
  'javascript_url',
  'data_url',
  'handler_prop',
  'missing_bound_field',
  'unmet_data',
  'unlabelled_control',
  'unknown_action',
  'unnamed_tool',
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];

export type ValidationOk<T> = { ok: true; spec: T };

export type ValidationFail = { ok: false; code: ValidationCode; reason: string };

export type ValidationResult<T = unknown> = ValidationOk<T> | ValidationFail;

export function fail(code: ValidationCode, reason: string): ValidationFail {
  return { ok: false, code, reason };
}
