type CrmConnection = {
  crm_type: string;
  api_key: string;
  is_active: boolean;
};

async function hubspotSyncContact(args: {
  apiKey: string;
  email: string;
  name: string;
  phone?: string;
}): Promise<void> {
  const { apiKey, email, name, phone } = args;
  const auth = `Bearer ${apiKey}`;

  const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: email,
            },
          ],
        },
      ],
    }),
  });

  const searchData = await searchRes.json().catch(() => null);
  if (!searchRes.ok) {
    throw new Error(`HubSpot search failed: HTTP ${searchRes.status}`);
  }

  const results =
    searchData && typeof searchData === "object" && searchData !== null
      ? (((searchData as any).results ?? []) as unknown[])
      : [];
  const existingId =
    results.length > 0 && results[0] && typeof results[0] === "object" && "id" in (results[0] as any)
      ? String((results[0] as any).id)
      : null;

  const properties = {
    email,
    firstname: name,
    phone: phone ?? "",
  };

  const writeRes = existingId
    ? await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(existingId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: auth,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties }),
        }
      )
    : await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties }),
      });

  if (!writeRes.ok) {
    const body = await writeRes.text().catch(() => "");
    throw new Error(`HubSpot write failed: HTTP ${writeRes.status} ${body}`);
  }
}

export async function syncContactToCRMs(
  supabase: any,
  userId: string,
  email: string,
  name: string,
  phone?: string
): Promise<void> {
  try {
    if (!supabase || !userId || !email) return;

    const { data, error } = await supabase
      .from("crm_connections")
      .select("crm_type, api_key, is_active")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      console.warn("[crmSync] failed to load crm_connections", { userId, message: error.message });
      return;
    }

    const connections = (Array.isArray(data) ? data : []) as CrmConnection[];
    for (const c of connections) {
      const crmType = (c.crm_type ?? "").trim().toLowerCase();
      const apiKey = (c.api_key ?? "").trim();
      if (!apiKey) continue;

      try {
        if (crmType === "hubspot") {
          await hubspotSyncContact({ apiKey, email, name, phone });
          console.info("[crmSync] hubspot contact synced", { userId });
        } else {
          console.info("[crmSync] crm sync not implemented; skipping", { userId, crmType });
        }
      } catch (err) {
        console.warn("[crmSync] crm sync failed; continuing", {
          userId,
          crmType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    console.warn("[crmSync] unexpected failure; continuing", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

