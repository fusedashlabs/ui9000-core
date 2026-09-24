import type { Trace } from '../trace/trace.js';
import { holdAction, openProposalSession } from './proposal.js';
import { classifyActions } from './risk.js';

type TraceCore = Omit<Trace, 'risk' | 'proposals' | 'proposal' | 'outcome'>;

/** One classification for decide() and show_workspace. Scoring stays outside. */
export function governTrace(core: TraceCore, catalogActions: readonly string[]): Trace {
  const classified = classifyActions(catalogActions);
  const session = openProposalSession();
  for (const action of classified) holdAction(session, action);
  const proposals = session.proposals.map((held) => ({
    id: held.id,
    action: held.action,
    preview: held.preview,
  }));
  return {
    ...core,
    risk: classified.map(({ action, band }) => ({ action, band })),
    proposals,
    proposal: proposals[0] ?? null,
    outcome: proposals.length > 0 ? 'held' : 'rendered',
  };
}
