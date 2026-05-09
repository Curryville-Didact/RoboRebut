-- Phase 9: Feature flags
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

INSERT INTO feature_flags (key, enabled, description)
VALUES
  ('coaching.live_mode', true, 'Enable live coaching WebSocket mode'),
  ('billing.polar', true, 'Enable Polar billing integration'),
  ('crm.outbound_sync', true, 'Enable outbound CRM contact sync'),
  ('transcription.async', true, 'Enable async transcription via Bull queue'),
  ('analytics.pattern_intelligence', true, 'Enable pattern intelligence analytics'),
  ('maintenance_mode', false, 'Put app in maintenance mode (blocks all non-admin requests)')
ON CONFLICT (key) DO NOTHING;

-- Phase 9: Performance indexes (safe to re-run)
CREATE INDEX IF NOT EXISTS idx_conversations_user_id
  ON public.conversations(user_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON public.messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_rebuttal_events_user_id
  ON public.rebuttal_events(user_id);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_integration_endpoint_id
  ON public.integration_delivery_logs(integration_endpoint_id);

CREATE INDEX IF NOT EXISTS idx_crm_connections_user_id
  ON public.crm_connections(user_id);
