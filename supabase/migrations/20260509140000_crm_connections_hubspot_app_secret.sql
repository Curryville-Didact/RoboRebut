-- HubSpot app secret for native webhook verification (X-HubSpot-Signature-v3)
alter table public.crm_connections
  add column if not exists hubspot_app_secret text;

comment on column public.crm_connections.hubspot_app_secret is
  'HubSpot developer app client secret for verifying inbound webhooks (optional).';
