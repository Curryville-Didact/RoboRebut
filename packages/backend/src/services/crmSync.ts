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

async function gohighlevelSyncContact(args: {
  apiKey: string;
  email: string;
  name: string;
  phone?: string;
}): Promise<void> {
  const { apiKey, email, name, phone } = args;
  const auth = `Bearer ${apiKey}`;

  const searchUrl = `https://services.leadconnectorhq.com/contacts/search?email=${encodeURIComponent(
    email
  )}`;
  const searchRes = await fetch(searchUrl, {
    method: "GET",
    headers: {
      Authorization: auth,
      Version: "2021-07-28",
    },
  });

  const searchText = await searchRes.text().catch(() => "");
  if (!searchRes.ok) {
    throw new Error(`GoHighLevel search failed: HTTP ${searchRes.status} ${searchText}`);
  }

  let contactId: string | null = null;
  try {
    const searchData = searchText ? (JSON.parse(searchText) as any) : null;
    const contacts: unknown[] = Array.isArray(searchData?.contacts)
      ? searchData.contacts
      : Array.isArray(searchData?.results)
        ? searchData.results
        : [];
    const first = contacts.length > 0 ? contacts[0] : null;
    if (first && typeof first === "object") {
      const idVal = (first as any).id ?? (first as any)._id ?? (first as any).contactId;
      if (idVal !== undefined && idVal !== null && String(idVal).trim()) {
        contactId = String(idVal);
      }
    }
  } catch {
    // If parsing fails, treat as no results; write will be a create.
  }

  const payload = {
    firstName: name,
    email,
    phone: phone ?? "",
  };

  const writeRes = contactId
    ? await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`, {
        method: "PUT",
        headers: {
          Authorization: auth,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })
    : await fetch("https://services.leadconnectorhq.com/contacts/", {
        method: "POST",
        headers: {
          Authorization: auth,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

  if (!writeRes.ok) {
    const body = await writeRes.text().catch(() => "");
    throw new Error(`GoHighLevel write failed: HTTP ${writeRes.status} ${body}`);
  }
}

async function zohoSyncContact(args: {
  apiKey: string;
  email: string;
  name: string;
  phone?: string;
}): Promise<void> {
  const { apiKey, email, name, phone } = args;
  const auth = `Zoho-oauthtoken ${apiKey}`;

  const criteria = `(Email:equals:${email})`;
  const searchUrl = `https://www.zohoapis.com/crm/v2/Contacts/search?criteria=${encodeURIComponent(
    criteria
  )}`;
  const searchRes = await fetch(searchUrl, {
    method: "GET",
    headers: {
      Authorization: auth,
    },
  });

  const searchText = await searchRes.text().catch(() => "");
  if (!searchRes.ok) {
    throw new Error(`Zoho search failed: HTTP ${searchRes.status} ${searchText}`);
  }

  let existingId: string | null = null;
  try {
    const searchData = searchText ? (JSON.parse(searchText) as any) : null;
    const dataArr: unknown[] = Array.isArray(searchData?.data) ? searchData.data : [];
    const first = dataArr.length > 0 ? dataArr[0] : null;
    if (first && typeof first === "object") {
      const idVal = (first as any).id;
      if (idVal !== undefined && idVal !== null && String(idVal).trim()) {
        existingId = String(idVal);
      }
    }
  } catch {
    // If parsing fails, treat as no results; write will be a create.
  }

  const payloadData = existingId
    ? [{ id: existingId, Last_Name: name, Email: email, Phone: phone ?? "" }]
    : [{ Last_Name: name, Email: email, Phone: phone ?? "" }];

  const writeRes = await fetch("https://www.zohoapis.com/crm/v2/Contacts", {
    method: existingId ? "PUT" : "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: payloadData }),
  });

  if (!writeRes.ok) {
    const body = await writeRes.text().catch(() => "");
    throw new Error(`Zoho write failed: HTTP ${writeRes.status} ${body}`);
  }
}

async function salesforceSyncContact(args: {
  apiKey: string;
  email: string;
  name: string;
  phone?: string;
}): Promise<void> {
  const { apiKey, email, name, phone } = args;
  const auth = `Bearer ${apiKey}`;

  const safeEmail = email.replace(/'/g, "\\'");
  const soql = `SELECT Id FROM Contact WHERE Email='${safeEmail}' LIMIT 1`;
  const queryUrl = `https://login.salesforce.com/services/data/v57.0/query?q=${encodeURIComponent(
    soql
  )}`;
  const queryRes = await fetch(queryUrl, {
    method: "GET",
    headers: {
      Authorization: auth,
    },
  });

  const queryText = await queryRes.text().catch(() => "");
  if (!queryRes.ok) {
    throw new Error(`Salesforce query failed: HTTP ${queryRes.status} ${queryText}`);
  }

  let existingId: string | null = null;
  try {
    const queryData = queryText ? (JSON.parse(queryText) as any) : null;
    const records: unknown[] = Array.isArray(queryData?.records) ? queryData.records : [];
    const first = records.length > 0 ? records[0] : null;
    if (first && typeof first === "object") {
      const idVal = (first as any).Id ?? (first as any).id;
      if (idVal !== undefined && idVal !== null && String(idVal).trim()) {
        existingId = String(idVal);
      }
    }
  } catch {
    // If parsing fails, treat as no results; write will be a create.
  }

  const payload = {
    LastName: name,
    Email: email,
    Phone: phone ?? "",
  };

  const writeRes = existingId
    ? await fetch(
        `https://login.salesforce.com/services/data/v57.0/sobjects/Contact/${encodeURIComponent(
          existingId
        )}`,
        {
          method: "PATCH",
          headers: {
            Authorization: auth,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      )
    : await fetch("https://login.salesforce.com/services/data/v57.0/sobjects/Contact", {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

  if (!writeRes.ok) {
    const body = await writeRes.text().catch(() => "");
    throw new Error(`Salesforce write failed: HTTP ${writeRes.status} ${body}`);
  }
}

async function velocifySyncContact(args: {
  apiKey: string;
  email: string;
  name: string;
  phone?: string;
}): Promise<void> {
  const { apiKey, email, name, phone } = args;

  const res = await fetch("https://leads.velocify.com/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey,
      firstName: name,
      lastName: "",
      email,
      phone: phone ?? "",
      duplicateCheck: 1,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Velocify write failed: HTTP ${res.status} ${body}`);
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
        } else if (crmType === "gohighlevel") {
          await gohighlevelSyncContact({ apiKey, email, name, phone });
          console.info("[crmSync] gohighlevel contact synced", { userId });
        } else if (crmType === "zoho") {
          await zohoSyncContact({ apiKey, email, name, phone });
          console.info("[crmSync] zoho contact synced", { userId });
        } else if (crmType === "salesforce") {
          await salesforceSyncContact({ apiKey, email, name, phone });
          console.info("[crmSync] salesforce contact synced", { userId });
        } else if (crmType === "velocify") {
          await velocifySyncContact({ apiKey, email, name, phone });
          console.info("[crmSync] velocify contact synced", { userId });
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

