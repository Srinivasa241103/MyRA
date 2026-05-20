export const buildGenerateDraftPrompt = (state, isRegenerate = false) => {
  const { emailDetails, originalEmail, draftHistory } = state;
  const toList = emailDetails.to
    .map((r) => (r.name ? `${r.name} <${r.email || "unknown"}>` : r.email))
    .join(", ");

  const ccList = emailDetails.cc.map((r) => r.email || r.name).join(", ");

  const replyBlock =
    emailDetails.isReply && originalEmail.messageId
      ? `\nORIGINAL EMAIL YOU ARE REPLYING TO:\nFrom: ${originalEmail.from}\nSubject: ${originalEmail.subject}\nDate: ${originalEmail.timestamp}\n---\n${originalEmail.bodyPreview}\n---\n`
      : "";

  const regenerateBlock =
    isRegenerate && draftHistory.length > 0
      ? `\nPREVIOUS DRAFT (write a meaningfully different version — vary structure, opening, and approach):\nSubject: ${draftHistory[draftHistory.length - 1].subject}\n${draftHistory[draftHistory.length - 1].body}\n`
      : "";

  return {
    system: `You are drafting a professional email on behalf of the user.
Write only the email content — no commentary, no explanation, no meta-text.
The body should be plain text (no HTML, no markdown).
Return ONLY a valid JSON object: { "subject": "<subject line>", "body": "<full email body>" }
No preamble, no explanation, no markdown code fences.`,

    user: `Draft an email with the following details:
 
To: ${toList || "(recipient TBD)"}
${ccList ? `CC: ${ccList}` : ""}
${emailDetails.subject ? `Subject hint: ${emailDetails.subject}` : "Generate an appropriate subject line."}
Tone: ${emailDetails.tone}
Type: ${emailDetails.isReply ? "Reply to an existing email" : "New email"}
 
WHAT THE EMAIL SHOULD SAY:
${emailDetails.bodyIntent}
${replyBlock}
${regenerateBlock}
Return ONLY the JSON object: { "subject": "...", "body": "..." }`,
  };
};
