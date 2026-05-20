const buildParseIntentPrompt = (userMessage, accumulatedState) => {
  const { status, emailDetails } = accumulatedState;
  const isReviewingMode = status === "reviewing";
  if (isReviewingMode) {
    return {
      system: `You are classifying user feedback on an email draft they have been shown.
                Classify their message into exactly one category:
                - "approve" — they want to accept, send, or save the draft as-is
                Examples: "looks good", "send it", "save it", "perfect", "yes", "that works"
                - "edit" — they want specific changes made to the draft
                Examples: "make it shorter", "change the tone", "remove the second paragraph", "add a deadline"
                - "regenerate" — they want a completely new version written from scratch
                Examples: "try again", "start over", "I don't like this", "write a different one"
                - "cancel" — they want to abort the email entirely
                Examples: "cancel", "never mind", "forget it", "stop", "don't send"
                
                Return ONLY a valid JSON object. No preamble, no explanation, no markdown fences.
                Format: { "feedbackClassification": "<category>", "editInstruction": "<their instruction verbatim if edit, else null>" }`,

      user: userMessage,
    };
  }

  const existingDetails = JSON.stringify(
    {
      to: emailDetails.to,
      bodyIntent: emailDetails.bodyIntent,
      tone: emailDetails.tone,
      isReply: emailDetails.isReply,
    },
    null,
    2
  );

  return {
    system: `You are extracting email composition details from a user message.
 
Already captured in previous turns (DO NOT override these with null — only update if the user provides new information for that field):
${existingDetails}
 
Extract from the user's CURRENT message only. For any field not mentioned this turn, return null.
 
Return ONLY a valid JSON object with exactly these fields:
{
  "isReply": boolean,
  "replyReference": string | null,
  "to": [ { "email": string | null, "name": string | null } ],
  "cc": [ { "email": string | null, "name": string | null } ],
  "bcc": [ { "email": string | null, "name": string | null } ],
  "subject": string | null,
  "bodyIntent": string | null,
  "tone": "formal" | "casual" | "friendly" | "professional",
  "mode": "send" | "save_draft",
  "additionalContext": string | null
}
 
Rules:
- Return an empty array [] for to/cc/bcc if not mentioned this turn — NOT null
- "mode" defaults to "save_draft" unless the user explicitly says "send"
- "tone" defaults to "professional" if not mentioned
- "bodyIntent" must be a clear natural language instruction: "Tell Priya the deadline moved to Friday"
- If only a name is given for a recipient, set email: null, name: "<name>"
- Do NOT invent or guess email addresses
- No preamble, no explanation, ONLY the JSON object`,
    user: userMessage,
  };
};

export default buildParseIntentPrompt;
