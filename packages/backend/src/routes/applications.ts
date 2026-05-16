import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

const STORAGE_BUCKET = "didact-documents";

/**
 * Text field names that map to `public.applications` columns (excluding `id`,
 * `document_urls`, boolean flags below, and server-managed timestamps).
 * Keep in sync with Supabase.
 */
const FIELD_MAP: Record<string, string> = {
  businessLegalName: "business_legal_name",
  businessDba: "business_dba",
  businessPhone: "business_phone",
  businessEmail: "business_email",
  physicalAddress: "business_address",
  physicalCity: "business_city",
  physicalState: "business_state",
  physicalZip: "business_zip",
  legalEntity: "entity_type",
  businessStartDate: "business_start_date",
  taxId: "ein",
  homeBased: "home_based",
  openJudgements: "open_judgements",
  openBankruptcies: "open_bankruptcies",
  industryType: "industry_sic",
  businessDescription: "business_description",
  amountRequested: "amount_requested",
  fundsNeeded: "funds_needed_timeline",
  grossAnnualSales: "gross_annual_sales",
  grossMonthlySales: "gross_monthly_sales",
  monthlyCreditCardVolume: "monthly_cc_volume",
  hasCashAdvance: "existing_advance",
  cashAdvanceBalance: "existing_advance_balance",
  useOfFunds: "use_of_funds",
  ownerFirstName: "owner_first_name",
  ownerLastName: "owner_last_name",
  ownerTitle: "owner_title",
  ownershipPct: "owner_percentage",
  ownerAddress: "owner_address",
  ownerCity: "owner_city",
  ownerState: "owner_state",
  ownerZip: "owner_zip",
  ownerDob: "owner_dob",
  ownerSsnLast4: "owner_ssn_last4",
  ownerMobilePhone: "owner_phone",
  coFirstName: "coowner_first_name",
  coLastName: "coowner_last_name",
  coTitle: "coowner_title",
  coOwnershipPct: "coowner_percentage",
  coAddress: "coowner_address",
  coDob: "coowner_dob",
  coSsnLast4: "coowner_ssn_last4",
  signatureName: "signature_name",
  authAgreed: "signature_agreed",
};

const ALLOWED_MULTIPART_FIELDS = new Set<string>([
  "lead_id",
  ...Object.keys(FIELD_MAP),
]);

function stringifyPartValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8");
  }
  return String(value);
}

function safeFilename(name: string): string {
  const base = name.replace(/^.*[/\\]/, "").replace(/\0/g, "");
  const trimmed = base.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : "document";
}

function safePathSegment(segment: string): string {
  return segment.replace(/[/\\\0]/g, "").trim().slice(0, 200);
}

type QueuedFile = {
  filename: string;
  mimetype: string;
  buffer: Buffer;
};

export async function applicationsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/applications", async (request, reply) => {
    try {
      if (!app.supabase) {
        return reply.status(503).send({ error: "Supabase unavailable" });
      }
      const { data, error } = await app.supabase
        .from("applications")
        .select("id, business_legal_name, business_dba, owner_first_name, owner_last_name, business_phone, amount_requested, gross_monthly_sales, industry_sic, entity_type, status, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        return reply.status(500).send({ error: error.message });
      }
      return reply.send({ applications: data ?? [] });
    } catch (err) {
      console.error("[applications] list error:", err);
      return reply.status(500).send({ error: "Failed to fetch applications" });
    }
  });

  app.post("/api/applications", async (request, reply) => {
    if (!app.supabase) {
      return reply.status(503).send({ error: "Application capture unavailable" });
    }

    if (!request.isMultipart()) {
      return reply
        .status(400)
        .send({ error: "Expected multipart/form-data" });
    }

    try {
      const fieldValues: Record<string, string> = {};
      const queuedFiles: QueuedFile[] = [];

      for await (const part of request.parts()) {
        if (part.type === "field") {
          const { fieldname } = part;
          if (!ALLOWED_MULTIPART_FIELDS.has(fieldname)) {
            continue;
          }
          fieldValues[fieldname] = stringifyPartValue(part.value);
        } else if (part.type === "file") {
          const buffer = await part.toBuffer();
          if (buffer.length === 0) {
            continue;
          }
          queuedFiles.push({
            filename: part.filename,
            mimetype: part.mimetype,
            buffer,
          });
        }
      }

      const lead_id = (fieldValues.lead_id ?? "").trim();
      if (!lead_id) {
        return reply.status(400).send({ error: "Missing lead_id" });
      }

      const leadSegment = safePathSegment(lead_id);
      const documentUrls: string[] = [];

      for (const file of queuedFiles) {
        const uniqueName = `${randomUUID()}_${safeFilename(file.filename)}`;
        const objectPath = `applications/${leadSegment}/${uniqueName}`;

        const { error: uploadError } = await app.supabase.storage
          .from(STORAGE_BUCKET)
          .upload(objectPath, file.buffer, {
            contentType: file.mimetype || "application/octet-stream",
          });

        if (uploadError) {
          console.error("[applications] storage upload error:", uploadError);
          return reply.status(500).send({ error: "Failed to save application" });
        }

        const { data: publicData } = app.supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(objectPath);

        if (publicData?.publicUrl) {
          documentUrls.push(publicData.publicUrl);
        }
      }

      const insertRow: Record<string, unknown> = {
        lead_id,
        document_urls: documentUrls,
      };

      for (const [formKey, dbCol] of Object.entries(FIELD_MAP)) {
        if (fieldValues[formKey] === undefined) continue;
        const trimmed = fieldValues[formKey].trim();
        insertRow[dbCol] = trimmed === "" ? null : trimmed;
      }

      // Also handle boolean fields
      const BOOLEAN_MAP: Record<string, string> = {
        homeBased: "home_based",
        openJudgements: "open_judgements",
        openBankruptcies: "open_bankruptcies",
        hasCashAdvance: "existing_advance",
        authAgreed: "signature_agreed",
      };
      for (const [formKey, dbCol] of Object.entries(BOOLEAN_MAP)) {
        if (fieldValues[formKey] !== undefined) {
          insertRow[dbCol] = fieldValues[formKey] === "true";
        }
      }

      const { data, error } = await app.supabase
        .from("applications")
        .insert([insertRow])
        .select()
        .single();

      if (error) {
        console.error("[applications] insert error:", error);
        return reply.status(500).send({ error: "Failed to save application" });
      }

      return reply.status(201).send({ success: true, application_id: data.id });
    } catch (err) {
      console.error("[applications] handler error:", err);
      return reply.status(500).send({ error: "Failed to save application" });
    }
  });

  app.get("/api/applications/:id/export", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      if (!app.supabase) {
        return reply.status(503).send({ error: "Supabase unavailable" });
      }

      const { data: application, error: appError } = await app.supabase
        .from("applications")
        .select("*")
        .eq("id", id)
        .single();

      if (appError || !application) {
        return reply.status(404).send({ error: "Application not found" });
      }

      let lead = {};
      if (application.lead_id) {
        const { data: leadData } = await app.supabase
          .from("leads")
          .select("*")
          .eq("id", application.lead_id)
          .single();
        if (leadData) lead = leadData;
      }

      const { generateLenderPDF } = await import("../lib/generateLenderPDF.js");
      const pdfBytes = await generateLenderPDF(application, lead);

      const safeName = (application.business_legal_name ?? id)
        .replace(/[^a-zA-Z0-9]/g, "-")
        .slice(0, 50);
      const filename = `didact-${safeName}.pdf`;

      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(Buffer.from(pdfBytes));

    } catch (err) {
      console.error("[applications] export error:", err);
      return reply.status(500).send({ error: "Failed to generate PDF" });
    }
  });
}
