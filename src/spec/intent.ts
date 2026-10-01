/** Closed intent enum — Stage 3 must not rename or add values. */
export const INTENTS = [
  'spatial',
  'comparison',
  'summary',
  'form',
  'evidence',
  'graph',
] as const;

export type Intent = (typeof INTENTS)[number];

/** A tool argument that is one of the closed intents, or nothing. */
export function intentFrom(value: string): Intent | undefined {
  return (INTENTS as readonly string[]).includes(value) ? (value as Intent) : undefined;
}
