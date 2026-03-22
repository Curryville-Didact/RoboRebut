"use client";

import { useEffect, useRef } from "react";
import { WS_URL } from "@/lib/env";

/**
 * Keeps a lightweight WebSocket to the Fastify backend so the browser
 * uses the correct host/port (avoids stale bundles pointing at :3000/:4000).
 * Does not surface UI; closes on unmount.
 */
export function BackendWebSocket(): null {
  const ref = useRef<WebSocket | null>(null);

  useEffect(() => {
    try {
      const ws = new WebSocket(WS_URL);
      ref.current = ws;
      ws.onerror = () => {
        // Avoid noisy console in production; devtools still shows failed WS if backend down
      };
      return () => {
        ws.close();
        ref.current = null;
      };
    } catch {
      return;
    }
  }, []);

  return null;
}
