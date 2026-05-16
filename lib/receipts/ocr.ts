// OCR pipeline for uploaded receipts (Plan v4 Phase F.3).
//
// Strategy: call the multimodal vision endpoint through the Vercel AI
// Gateway with a Zod-validated structured output schema. We never hit
// OpenAI/Anthropic directly — see lib/ai/gateway.ts for the rationale
// (cost tracking + per-deploy model swaps via env strings).
//
// API surface verified 2026-05-16 against the locally-installed
// `ai@^6.0.183`:
//   - `generateObject({ model, schema, messages, schemaName, schemaDescription })`
//     returns `{ object: T, finishReason, usage, ... }`.
//   - Multimodal user content: an array of parts where each part is
//     `{ type: 'text', text }` or `{ type: 'image', image: Buffer|string|URL }`.
//     PDFs go through `{ type: 'file', mediaType, data }` instead.
//
// Fail-soft contract: the function returns `null` on any kind of failure
// (model timeout, schema validation, gateway disabled). Routes that call
// extractReceipt must handle null by leaving the receipt row at
// `status='pending_review'` with parsed fields NULL — the operator can
// retry from the UI.
//
// OCR-specific model selection: receipts have mixed Hebrew/English text
// and we want the higher-capacity model. We use AI_ESCALATION_MODEL
// (default `openai/gpt-5.4`) — falls back to AI_MODEL if the escalation
// var is unset.

import { generateObject } from "ai";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  getDefaultModel,
  isAiGatewayEnabled,
} from "@/lib/ai/gateway";

// ---------------------------------------------------------------------------
// Zod schema — the model is forced to emit JSON conforming to this shape.
// All amounts are major-unit numbers from the receipt face (e.g. "12.50"
// becomes 12.50). We coerce to minor (bigint) only after validation so
// the model doesn't have to reason about cents math.

const itemSchema = z.object({
  description: z.string().min(1).max(500),
  amount_major: z
    .number()
    .nonnegative()
    .describe("Line amount in major currency units (e.g. 12.50 for ₪12.50)"),
});

export const ocrResultSchema = z.object({
  vendor: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "Vendor / seller / business name as printed on the receipt. Hebrew or English.",
    ),
  amount_major: z
    .number()
    .nonnegative()
    .describe(
      "Total amount paid, in major units (₪/USD/EUR). Includes VAT if present.",
    ),
  currency: z
    .enum(["ILS", "USD", "EUR"])
    .describe("Currency code. Default ILS when the receipt is in Hebrew."),
  vat_major: z
    .number()
    .nonnegative()
    .nullable()
    .describe(
      "VAT amount in major units, or null if VAT not separately stated.",
    ),
  vat_rate: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .describe(
      "VAT rate as a percentage (e.g. 18 for 18% Israeli VAT), or null.",
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      "Receipt date in ISO YYYY-MM-DD. Parse Israeli DD/MM/YYYY into ISO.",
    ),
  items: z
    .array(itemSchema)
    .max(50)
    .describe("Line items if printed on the receipt. Empty array if none."),
});

export type OcrResultRaw = z.infer<typeof ocrResultSchema>;

// Post-coercion shape consumed by callers. Amounts in minor (bigint).
export type OcrResult = {
  vendor: string;
  amount_minor: bigint;
  currency: "ILS" | "USD" | "EUR";
  vat_minor: bigint | null;
  vat_rate: number | null;
  date: string;
  items: Array<{ description: string; amount_minor: bigint }>;
};

// 2dp currencies — the only ones we ship today. JPY/BHD would need a
// table here, but the locked-in supported set is ILS/USD/EUR.
function majorToMinor(major: number): bigint {
  return BigInt(Math.round(major * 100));
}

function coerceOcr(raw: OcrResultRaw): OcrResult {
  return {
    vendor: raw.vendor.trim(),
    amount_minor: majorToMinor(raw.amount_major),
    currency: raw.currency,
    vat_minor: raw.vat_major === null ? null : majorToMinor(raw.vat_major),
    vat_rate: raw.vat_rate,
    date: raw.date,
    items: raw.items.map((it) => ({
      description: it.description.trim(),
      amount_minor: majorToMinor(it.amount_major),
    })),
  };
}

// ---------------------------------------------------------------------------
// Prompt. Kept short — the schema does most of the heavy lifting.

const OCR_SYSTEM_PROMPT = `You are an Israeli-VAT-aware OCR pipeline.
Extract structured data from the receipt image or PDF the user provides.

Rules:
- Output ONLY the JSON the schema demands; no commentary.
- If the receipt is in Hebrew, keep vendor + line descriptions in Hebrew.
- Israeli date format is DD/MM/YYYY. Convert to ISO YYYY-MM-DD.
- VAT (מע"מ) lines: capture both the amount and the rate when both are printed; otherwise null.
- Currency default = ILS (₪). USD = $ / USD. EUR = € / EUR.
- Amounts are in MAJOR units (e.g. enter 12.50 for ₪12.50, never 1250).
- If the image is unreadable, low-confidence, or shows something that is not a receipt, still return well-formed JSON with vendor="unknown", amount_major=0, items=[], currency="ILS", date set to today, and let the operator review.`;

type ExtractInput =
  | { kind: "image"; buffer: Buffer; mimeType: string }
  | { kind: "pdf"; buffer: Buffer; mimeType: "application/pdf" };

function classifyMime(mimeType: string): ExtractInput["kind"] | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return null;
}

/**
 * Run OCR over a receipt buffer. Returns `null` on any failure — callers
 * must persist the receipt row regardless and let the operator retry.
 *
 * The escalation model (openai/gpt-5.4 by default) is preferred because
 * mixed Hebrew/English receipts are noticeably more accurate on the
 * larger model. Operators can swap via env without redeploying.
 */
export async function extractReceipt(
  imageBuffer: Buffer,
  mimeType: string,
): Promise<OcrResult | null> {
  if (!isAiGatewayEnabled()) {
    return null;
  }

  const kind = classifyMime(mimeType);
  if (!kind) {
    // jpeg / png / webp / pdf only; everything else is unsupported.
    return null;
  }

  const model = getDefaultModel(env().AI_ESCALATION_MODEL);
  if (!model) return null;

  // Multimodal content per ai@6 docs (foundations/03-prompts.mdx):
  //   { type: 'image', image: Buffer | string | URL }
  //   { type: 'file', mediaType, data }
  const contentParts =
    kind === "image"
      ? [
          {
            type: "text" as const,
            text: "Extract structured data from this receipt.",
          },
          { type: "image" as const, image: imageBuffer },
        ]
      : [
          {
            type: "text" as const,
            text: "Extract structured data from this receipt PDF.",
          },
          {
            type: "file" as const,
            mediaType: mimeType,
            data: imageBuffer,
          },
        ];

  try {
    const result = await generateObject({
      model,
      schema: ocrResultSchema,
      schemaName: "Receipt",
      schemaDescription:
        "Structured extraction of an Israeli (or English) receipt: vendor, totals, VAT, date, line items.",
      system: OCR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: contentParts,
        },
      ],
    });
    return coerceOcr(result.object);
  } catch (err) {
    // Fail soft — log and let the row sit at pending_review.
    // eslint-disable-next-line no-console
    console.warn("[receipts.ocr] extractReceipt failed", {
      mimeType,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Pure helper exposed for tests. Converts a major-unit OCR raw shape
 * into the minor-unit canonical OcrResult. Keeps the math
 * deterministic-testable without mocking the model.
 */
export function coerceOcrForTests(raw: OcrResultRaw): OcrResult {
  return coerceOcr(raw);
}
