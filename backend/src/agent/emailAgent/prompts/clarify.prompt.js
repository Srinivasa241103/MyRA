export const buildClarifyPrompt = (missingFields, emailDetails, intent) => {
  const fieldDescriptions = {
    bodyIntent: "what the email should say or communicate",
    recipient: "who the email should be sent to",
    replyReference: "which specific email they want to reply to",
    resolvedEmail:
      "which email they mean (could not find a confident match in inbox)",
  };

  // Ask about the first missing field only — one question per turn
  const fieldToAsk = missingFields[0];
  const description = fieldDescriptions[fieldToAsk] || fieldToAsk;

  // Build partial context so the question sounds informed, not generic
  const partialContext = [];
  if (emailDetails.bodyIntent) {
    partialContext.push(`The email should: ${emailDetails.bodyIntent}`);
  }
  if (emailDetails.to.length > 0) {
    const recipient = emailDetails.to[0].name || emailDetails.to[0].email;
    partialContext.push(`Going to: ${recipient}`);
  }
  if (emailDetails.tone && emailDetails.tone !== "professional") {
    partialContext.push(`Tone: ${emailDetails.tone}`);
  }

  const contextString =
    partialContext.length > 0
      ? `What I know so far: ${partialContext.join(". ")}.`
      : "";

  return {
    system: `You are a helpful AI assistant helping the user compose an email.
Ask exactly one short, natural follow-up question to gather the missing information.
Be conversational — not robotic or formal.
Do not explain what you are doing or list multiple questions.
Do not say "I need to know" or "please provide" — just ask naturally.`,

    user: `The user wants to ${intent === "email_reply" ? "reply to an email" : "compose a new email"}.
${contextString}
 
I still need to know: ${description}.
 
Write a single natural question to get this information.`,
  };
};
