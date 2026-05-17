"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  "https://roborebutbackend-production.up.railway.app";

type Application = {
  id: string;
  business_legal_name: string | null;
  business_dba: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  owner_ssn_last4: string | null;
  business_phone: string | null;
  amount_requested: string | null;
  gross_monthly_sales: string | null;
  industry_sic: string | null;
  entity_type: string | null;
  status: string | null;
  created_at: string | null;
};

type SsnModalState = {
  applicationId: string;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  ownerSsn: string | null;
};

function formatSsn(ssn: string | null): string {
  if (!ssn) return "—";
  const digits = ssn.replace(/\D/g, "");
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }
  return ssn;
}

function maskLast4(last4: string | null): string {
  if (!last4) return "—";
  const digits = last4.replace(/\D/g, "").slice(-4);
  return digits.length === 4 ? `***-**-${digits}` : last4;
}

export default function DidactAdminPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [ssnModal, setSsnModal] = useState<SsnModalState | null>(null);

  const closeSsnModal = useCallback(() => setSsnModal(null), []);

  useEffect(() => {
    if (!ssnModal) return;
    const timer = window.setTimeout(() => setSsnModal(null), 30_000);
    return () => window.clearTimeout(timer);
  }, [ssnModal]);

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

  const revealSsn = async (app: Application) => {
    setRevealingId(app.id);
    try {
      const token =
        (await createClient().auth.getSession()).data.session?.access_token ??
        null;
      if (!token) {
        alert("No session token available. Sign in as founder.");
        return;
      }

      const res = await fetch(`${API_BASE}/api/applications/${app.id}/ssn`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? `Reveal failed: ${res.status}`);
      }

      setSsnModal({
        applicationId: app.id,
        ownerFirstName: app.owner_first_name,
        ownerLastName: app.owner_last_name,
        ownerSsn: json.ownerSsn ?? null,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to reveal SSN");
    } finally {
      setRevealingId(null);
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
          <table className="w-full min-w-[1000px] text-left text-xs text-gray-200">
            <thead>
              <tr className="border-b border-white/10 bg-black/40 text-[11px] uppercase text-gray-500">
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">SSN</th>
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
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-gray-300">
                        {maskLast4(app.owner_ssn_last4)}
                      </span>
                      <button
                        type="button"
                        onClick={() => revealSsn(app)}
                        disabled={revealingId === app.id}
                        className="min-h-[24px] w-fit rounded border border-red-500/50 px-2 text-[10px] font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {revealingId === app.id ? "Loading..." : "Reveal SSN"}
                      </button>
                    </div>
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

      {/* SSN reveal modal */}
      {ssnModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ssn-modal-title"
        >
          <div className="w-full max-w-md rounded-lg border border-red-500/30 bg-gray-900 p-6 shadow-xl">
            <h2
              id="ssn-modal-title"
              className="text-lg font-bold text-red-400"
            >
              CONFIDENTIAL — Full SSN
            </h2>
            <div className="mt-4 space-y-2 text-sm text-gray-200">
              <p>
                <span className="text-gray-500">Owner: </span>
                {fmt(ssnModal.ownerFirstName)} {fmt(ssnModal.ownerLastName)}
              </p>
              <p className="font-mono text-lg text-white">
                {formatSsn(ssnModal.ownerSsn)}
              </p>
            </div>
            <p className="mt-4 text-xs text-gray-500">
              This information is confidential. Do not share or transmit
              unsecured.
            </p>
            <button
              type="button"
              onClick={closeSsnModal}
              className="mt-6 min-h-[36px] w-full rounded-lg border border-white/20 bg-white/10 text-sm font-medium text-gray-200 hover:bg-white/15"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
