export const buildApplyEditsPrompt = (
  currentDraft,
  editInstruction,
  emailDetails,
) => {
  return {
    system: `You are editing an email draft based on the user's specific instructions.
Apply the requested changes precisely.
Do not change parts of the email the user did not ask to change.
Preserve the original meaning and all important details unless instructed otherwise.
Return ONLY a valid JSON object: { "subject": "<subject>", "body": "<full edited body>" }
No preamble, no explanation, no markdown code fences.`,

    user: `Current draft:
Subject: ${currentDraft.subject}
---
${currentDraft.body}
---
 
User's edit instruction: "${editInstruction}"
 
Tone to maintain: ${emailDetails.tone}
 
Apply the edit and return the complete revised email as JSON: { "subject": "...", "body": "..." }`,
  };
};
