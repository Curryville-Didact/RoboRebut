import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

const STORAGE_BUCKET = "didact-documents";

/**
 * Text field names that map to `public.applications` columns (excluding `id`,
 * `document_urls`, boolean flags below, and server-managed timestamps).
 * Keep in sync with Supabase.
 */
const APPLICATION_TEXT_COLUMNS = [
  "lead_id",
  "business_legal_name",
  "business_dba",
  "business_phone",
  "business_email",
  "business_address",
  "business_city",
  "business_state",
  "business_zip",
  "entity_type",
  "business_start_date",
  "ein",
  "business_description",
  "industry_sic",
  "amount_requested",
  "funds_needed_timeline",
  "use_of_funds",
  "gross_annual_sales",
  "gross_monthly_sales",
  "monthly_cc_volume",
  "existing_advance_balance",
  "owner_first_name",
  "owner_last_name",
  "owner_title",
  "owner_percentage",
  "owner_address",
  "owner_city",
  "owner_state",
  "owner_zip",
  "owner_dob",
  "owner_ssn_last4",
  "owner_phone",
  "coowner_first_name",
  "coowner_last_name",
  "coowner_title",
  "coowner_percentage",
  "coowner_address",
  "coowner_dob",
  "coowner_ssn_last4",
  "signature_name",
  "status",
] as const;

const BOOLEAN_FORM_FIELDS = [
  "home_based",
  "open_judgements",
  "open_bankruptcies",
  "existing_advance",
  "signature_agreed",
] as const;

const ALLOWED_MULTIPART_FIELDS = new Set<string>([
  ...APPLICATION_TEXT_COLUMNS,
  ...BOOLEAN_FORM_FIELDS,
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

      for (const col of APPLICATION_TEXT_COLUMNS) {
        if (col === "lead_id") {
          continue;
        }
        if (fieldValues[col] === undefined) {
          continue;
        }
        const trimmed = fieldValues[col].trim();
        insertRow[col] = trimmed === "" ? null : trimmed;
      }

      if (fieldValues.home_based) {
        insertRow.home_based = fieldValues.home_based === 'true';
      }
      if (fieldValues.open_judgements) {
        insertRow.open_judgements = fieldValues.open_judgements === 'true';
      }
      if (fieldValues.open_bankruptcies) {
        insertRow.open_bankruptcies = fieldValues.open_bankruptcies === 'true';
      }
      if (fieldValues.existing_advance) {
        insertRow.existing_advance = fieldValues.existing_advance === 'true';
      }
      if (fieldValues.signature_agreed) {
        insertRow.signature_agreed = fieldValues.signature_agreed === 'true';
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
}
