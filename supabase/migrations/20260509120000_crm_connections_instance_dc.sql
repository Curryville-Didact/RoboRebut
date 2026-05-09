-- CRM enterprise config: Salesforce My Domain / Zoho data center
ALTER TABLE public.crm_connections
  ADD COLUMN IF NOT EXISTS instance_url TEXT;

ALTER TABLE public.crm_connections
  ADD COLUMN IF NOT EXISTS dc_region TEXT;
