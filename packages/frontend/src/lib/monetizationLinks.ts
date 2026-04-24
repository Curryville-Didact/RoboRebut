/**
 * Phase 5.3 — Conversion destinations (no Stripe in frontend).
 * Starter checkout uses `getStarterCheckoutHref` (Polar checkout session). Logged-in Starter users
 * hitting Pro use the customer-portal session path (see `SmartProCheckoutLink` / `resolveProBillingDestination`);
 * anonymous users still use `getProCheckoutHref` checkout sessions. Static `buy.polar.sh/...` links below are not used
 * for in-app purchase buttons; they remain as reference / off-app marketing only.
 */
export const MONETIZATION_LINKS = {
  pricing: "https://getrebut.ai/pricing",
  starterCheckout: "https://buy.polar.sh/polar_cl_kYa97zeHFWFN1O86eHczdHcsvrmGBAfCzHrRO03uwqA",
  proCheckout: "https://buy.polar.sh/polar_cl_zrpgHeaigHulLqK43FeM96XLuiVlajYJdUt6N0gKbQD",
  starter: "https://buy.polar.sh/polar_cl_kYa97zeHFWFN1O86eHczdHcsvrmGBAfCzHrRO03uwqA",
  pro: "https://buy.polar.sh/polar_cl_zrpgHeaigHulLqK43FeM96XLuiVlajYJdUt6N0gKbQD",
  teamDemo: "https://calendly.com/admin-getrebut/30min",
  unlock: "https://getrebut.ai/pricing",
  demo: "https://calendly.com/admin-getrebut/30min",
} as const;
