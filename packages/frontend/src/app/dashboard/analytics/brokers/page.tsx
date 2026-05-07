'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Broker {
  userId: string;
  email: string;
  rebuttals: number;
  conversations: number;
  avgRating: number | null;
}

interface Objection {
  type: string;
  count: number;
}

interface FounderAnalytics {
  brokers: Broker[];
  topObjections: Objection[];
}

export default function FounderAnalyticsPage() {
  const [data, setData] = useState<FounderAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Not authenticated'); setLoading(false); return; }

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/founder/analytics`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) { setError('Failed to load analytics'); setLoading(false); return; }
      const json = await res.json();
      setData(json);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading...</div>;
  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>;
  if (!data) return null;

  const totalRebuttals = data.brokers.reduce((a, b) => a + b.rebuttals, 0);
  const totalConversations = data.brokers.reduce((a, b) => a + b.conversations, 0);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Founder Analytics</h1>
        <p className="text-sm text-gray-400 mt-1">Rebuttal usage across all brokers.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Rebuttals', value: totalRebuttals },
          { label: 'Total Conversations', value: totalConversations },
          { label: 'Active Brokers', value: data.brokers.length },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-gray-700 bg-gray-900 p-4">
            <div className="text-xs text-gray-400 mb-1">{label}</div>
            <div className="text-2xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      {/* Broker table */}
      <div>
        <h2 className="text-lg font-medium mb-3">Brokers</h2>
        <div className="rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-right">Rebuttals</th>
                <th className="px-4 py-3 text-right">Conversations</th>
                <th className="px-4 py-3 text-right">Avg Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {data.brokers.map((b) => (
                <tr key={b.userId} className="bg-gray-900 hover:bg-gray-800">
                  <td className="px-4 py-3">{b.email}</td>
                  <td className="px-4 py-3 text-right">{b.rebuttals}</td>
                  <td className="px-4 py-3 text-right">{b.conversations}</td>
                  <td className="px-4 py-3 text-right">{b.avgRating ?? '—'}</td>
                </tr>
              ))}
              {data.brokers.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">No broker data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top objections */}
      <div>
        <h2 className="text-lg font-medium mb-3">Top Objections (All Brokers)</h2>
        <div className="rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Objection Type</th>
                <th className="px-4 py-3 text-right">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {data.topObjections.map((o) => (
                <tr key={o.type} className="bg-gray-900 hover:bg-gray-800">
                  <td className="px-4 py-3">{o.type}</td>
                  <td className="px-4 py-3 text-right">{o.count}</td>
                </tr>
              ))}
              {data.topObjections.length === 0 && (
                <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-500">No objection data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

