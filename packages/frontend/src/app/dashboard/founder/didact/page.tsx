"use client";

import { useEffect, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  "https://roborebutbackend-production.up.railway.app";

type Application = {
  id: string;
  business_legal_name: string | null;
  business_dba: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  business_phone: string | null;
  amount_requested: string | null;
  gross_monthly_sales: string | null;
  industry_sic: string | null;
  entity_type: string | null;
  status: string | null;
  created_at: string | null;
};

export default function DidactAdminPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const loadApplications = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/applications`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Error ${res.status}`);
        return;
      }
      setApplications(json.applications ?? json ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  };

  const exportPDF = async (id: string, businessName: string) => {
    setExportingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/applications/${id}/export`);
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `didact-${(businessName ?? id).replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportingId(null);
    }
  };

  useEffect(() => {
    loadApplications();
  }, []);

  const fmt = (v: string | null) => v ?? "—";
  const fmtMoney = (v: string | null) => {
    if (!v) return "—";
    const n = Number(String(v).replace(/[^0-9.-]/g, ""));
    return isNaN(n) ? v : `$${n.toLocaleString()}`;
  };
  const fmtDate = (v: string | null) =>
    v
      ? new Date(v).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Didact Capital</h1>
          <p className="text-sm text-gray-400 mt-1">Merchant Applications</p>
        </div>
        <button
          onClick={loadApplications}
          disabled={loading}
          className="min-h-[36px] rounded-lg border border-white/15 bg-white/[0.06] px-4 text-sm font-medium text-gray-200 hover:bg-white/[0.1] disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Error */}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Empty */}
      {!loading && applications.length === 0 && !error && (
        <p className="text-sm text-gray-500">No applications found.</p>
      )}

      {/* Loading */}
      {loading && (
        <p className="text-sm text-gray-500">Loading applications...</p>
      )}

      {/* Table */}
      {!loading && applications.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[900px] text-left text-xs text-gray-200">
            <thead>
              <tr className="border-b border-white/10 bg-black/40 text-[11px] uppercase text-gray-500">
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Industry</th>
                <th className="px-3 py-2">Requested</th>
                <th className="px-3 py-2">Monthly Rev</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Submitted</th>
                <th className="px-3 py-2">Export</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app, i) => (
                <tr
                  key={app.id}
                  className={`border-b border-white/5 align-top ${
                    i % 2 === 0 ? "bg-white/[0.02]" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-white">
                      {fmt(app.business_legal_name)}
                    </div>
                    {app.business_dba && (
                      <div className="text-gray-500">dba {app.business_dba}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {fmt(app.owner_first_name)} {fmt(app.owner_last_name)}
                  </td>
                  <td className="px-3 py-2">{fmt(app.business_phone)}</td>
                  <td className="px-3 py-2">{fmt(app.industry_sic)}</td>
                  <td className="px-3 py-2">{fmtMoney(app.amount_requested)}</td>
                  <td className="px-3 py-2">
                    {fmtMoney(app.gross_monthly_sales)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        app.status === "approved"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : app.status === "declined"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-white/10 text-gray-400"
                      }`}
                    >
                      {fmt(app.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{fmtDate(app.created_at)}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() =>
                        exportPDF(
                          app.id,
                          app.business_legal_name ?? app.id
                        )
                      }
                      disabled={exportingId === app.id}
                      className="min-h-[30px] rounded border border-cyan-500/40 bg-cyan-500/10 px-3 text-[11px] font-semibold text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {exportingId === app.id ? "Exporting..." : "Export PDF"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Count */}
      {applications.length > 0 && (
        <p className="text-xs text-gray-600">
          {applications.length} application
          {applications.length !== 1 ? "s" : ""} total
        </p>
      )}
    </div>
  );
}
