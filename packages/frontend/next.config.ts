/**
 * IMPORTANT:
 * This project uses Supabase in a monorepo with Next.js 15.
 * We MUST transpile these packages to prevent broken vendor-chunk references:
 *
 *   Cannot find module './vendor-chunks/@supabase.js'
 *
 * Similar stale-graph errors (e.g. Cannot find module '/383.js' in webpack-runtime)
 * are fixed the same way: delete `packages/frontend/.next` (and optionally
 * `packages/frontend/node_modules/.cache`), then restart `next dev`.
 *
 * ENOENT for `.next/server/pages/_document.js`: this app is App Router–only (no `src/pages/`),
 * but Next still emits internal `pages/_document.js` under `.next/server/pages/`. If that file
 * is missing, the graph is incomplete — use `npm run clean` (or `rm -rf .next`) and restart.
 * This is not a missing custom `_document`; do not add `pages/_document.tsx` unless you
 * intentionally adopt the Pages Router.
 *
 * If this error reappears:
 * 1. Run: rm -rf packages/frontend/.next
 * 2. Restart dev server
 *
 * Do NOT remove transpilePackages unless replacing with a verified bundling solution.
 */

import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  /** Polar success URLs use /conversations; serve the dashboard list without duplicating the page. */
  async rewrites() {
    return [{ source: "/conversations", destination: "/dashboard" }];
  },
  // Transpile Supabase so the client bundle does not emit broken relative refs to
  // `./vendor-chunks/@supabase.js` (missing chunk / stale graph) under Next 15 + webpack.
  transpilePackages: [
    "@supabase/ssr",
    "@supabase/supabase-js",
  ],
  // Avoid dev-only RSC + Segment Explorer manifest errors that can 500 `/` and
  // corrupt `.next` chunks (Cannot find module './116.js', missing page.js).
  experimental: {
    devtoolSegmentExplorer: false,
  },
};

export default config;
