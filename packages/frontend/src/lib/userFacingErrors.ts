/**
 * UI-only helpers: never surface raw API / schema strings to end users on polished surfaces.
 */

export const MSG_SESSION = "We couldn’t verify your session. Try refreshing the page.";
export const MSG_CONVERSATIONS_LOAD = "Unable to load conversations. Try refreshing.";
export const MSG_CONVERSATIONS_CREATE = "Couldn’t start a conversation. Try again.";
export const MSG_SAVED_LOAD = "Unable to load saved responses. Try refreshing.";
export const MSG_PERFORMANCE_LOAD = "Unable to load performance data. Try refreshing.";
export const MSG_REVIEW_LOAD = "Unable to load review data. Try refreshing.";
export const MSG_INSIGHTS_LOAD = "Unable to load insights. Try refreshing.";
export const MSG_INTEGRATIONS_LOAD = "Unable to load integrations. Try refreshing.";

export function isLikelyForbiddenStatus(status: number): boolean {
  return status === 401 || status === 403;
}
