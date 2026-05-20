import { z } from "zod";

const RecipientSchema = z
  .object({
    email: z
      .string()
      .email("Must be a valid email address")
      .nullable()
      .default(null),

    name: z.string().nullable().default(null),
  })
  .refine((val) => val.email != null || val.name !== null, {
    message: "Recipient must have at least an email or a name",
  });

const ToneEnum = z.enum(["formal", "casual", "friendly", "professional"]);

const ModeEnum = z.enum(["send", "save_draft"]);

const parseOutputSchema = z.object({
  isReply: z.boolean().default(false),
  replyReference: z.string().nullable().default(null),
  to: z.array(RecipientSchema).default([]),
  cc: z.array(RecipientSchema).default([]),
  bcc: z.array(RecipientSchema).default([]),
  subject: z.string().nullable().default(null),
  bodyIntent: z.string().nullable().default(null),
  tone: ToneEnum.default("professional"),
  mode: ModeEnum.default("save_draft"),
  additionalContext: z.string().nullable().default(null),
});

const safeParse = (rawOutput) => {
  const result = parseOutputSchema.safeParse(rawOutput);
  if (!result.success) {
    return {
      success: false,
      data: null,
      error: result.error.issues
        .map((issue) => `${issue.path.join(".")}:${issue.message}`)
        .join("; "),
    };
  }

  return {
    success: true,
    data: result.data,
    error: null,
  };
};

const applySafetyDefaults = (parsed) => {
  const safe = { ...parsed };
  if (safe.isReply && !safe.replyReference) {
    safe.replyReference = null;
  }
  // Capture user's intent to send, but keep mode as save_draft until explicitly approved.
  // shouldSend in sendOrSaveDraft checks _userRequestedSend directly.
  if (safe.mode === "send") {
    safe._userRequestedSend = true;
    safe.mode = "save_draft";
  } else {
    safe._userRequestedSend = false;
  }
  return safe;
};

export {
  parseOutputSchema,
  RecipientSchema,
  ToneEnum,
  ModeEnum,
  safeParse,
  applySafetyDefaults,
};
