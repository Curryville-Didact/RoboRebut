"use client";

import { useEffect } from "react";

export function DashboardViewportLock() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const prevHtmlHeight = html.style.height;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyHeight = body.style.height;
    const prevBodyOverflow = body.style.overflow;

    html.style.height = "100%";
    html.style.overflow = "hidden";
    body.style.height = "100%";
    body.style.overflow = "hidden";

    return () => {
      html.style.height = prevHtmlHeight;
      html.style.overflow = prevHtmlOverflow;
      body.style.height = prevBodyHeight;
      body.style.overflow = prevBodyOverflow;
    };
  }, []);

  return null;
}

