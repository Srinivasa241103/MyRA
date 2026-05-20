import { z } from "zod";

const draftOutputSchema = z.object({
  subject: z.string().min(1, "Subject cannot be empty"),
  body: z.string().min(1, "Body cannot be empty"),
});

/**
 * Safe parse wrapper — never throws.
 * Returns { success, data, error }.
 * Used by generateDraft and applyEdits nodes.
 */
const safeParseDraft = (rawOutput) => {
  const result = draftOutputSchema.safeParse(rawOutput);
  if (!result.success) {
    return {
      success: false,
      data: null,
      error: result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  return { success: true, data: result.data, error: null };
};

export { draftOutputSchema, safeParseDraft };
