/**
 * Conversation-level account intelligence (`client_context` JSONB).
 * All fields optional for legacy rows and partial saves.
 */
export type ClientContext = {
  businessName?: string;
  industry?: string;
  currentProvider?: string;
  monthlyRevenueText?: string;
  painPoints?: string;
  decisionMaker?: string;
  partnerInvolved?: boolean;
  urgencyTimeline?: string;
  trustFlags?: string;
  statedObjections?: string;
  notes?: string;
};
