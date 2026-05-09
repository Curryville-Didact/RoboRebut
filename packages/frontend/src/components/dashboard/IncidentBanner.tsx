"use client";

import { useEffect, useState } from "react";

interface SystemStatus {
  maintenance: boolean;
  message: string | null;
}

export function IncidentBanner() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
    fetch(`${API_URL}/api/system/status`)
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (!status?.maintenance || !status?.message) return null;

  return (
    <div className="w-full border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-center text-sm text-yellow-400">
      ⚠️ {status.message}
    </div>
  );
}
