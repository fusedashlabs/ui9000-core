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
