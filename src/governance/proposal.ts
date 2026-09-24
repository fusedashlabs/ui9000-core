import type { ClassifiedAction } from './risk.js';
import type { TraceProposal } from '../trace/trace.js';

/**
 * A held action becomes a preview. In Cursor or Claude this is displayed,
 * not enforced — Stage 5 blocks execution on a page we own.
 */
export type HeldProposal = TraceProposal & {
  id: string;
};

export type ProposalSession = {
  proposals: HeldProposal[];
};

export function openProposalSession(): ProposalSession {
  return { proposals: [] };
}

/** High-risk actions return a preview. Low-risk actions return null and are not held. */
export function holdAction(
  session: ProposalSession,
  action: ClassifiedAction,
): HeldProposal | null {
  if (action.band !== 'held') return null;
  const proposal: HeldProposal = {
    id: `proposal:${action.action}`,
    action: action.action,
    preview: `Preview ${action.action}. This is not an execution.`,
  };
  session.proposals.push(proposal);
  return proposal;
}
