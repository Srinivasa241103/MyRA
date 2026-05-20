const checkRequiredFields = async (state) => {
  const { emailDetails, originalEmail, intent, ambiguousFields } = state;
  const missing = [];

  if (ambiguousFields && ambiguousFields.length > 0) {
    return { status: "clarifying" };
  }

  if (!emailDetails.bodyIntent) {
    missing.push("bodyIntent");
  }

  if (intent === "email_draft") {
    const hasRecipient =
      emailDetails.to.length > 0 &&
      (emailDetails.to[0].email || emailDetails.to[0].name);
    if (!hasRecipient) missing.push("recipient");
  }

  if (intent === "email_reply") {
    if (!emailDetails.replyReference) {
      missing.push("replyReference");
    }
    if (emailDetails.replyReference && !originalEmail.messageId) {
      missing.push("resolvedEmail");
    }
  }

  return {
    missingFields: missing,
    status: missing.length > 0 ? "clarifying" : "generating",
  };
};

export { checkRequiredFields };
