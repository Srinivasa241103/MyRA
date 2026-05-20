import { google } from "googleapis";

/**
 * Wraps Gmail API send and draft-save operations.
 *
 * Assumes getAuthClient() is available from your existing OAuth setup.
 * Adjust the import path to match where your Google OAuth provider lives.
 */
import { getAuthClient } from "../oauth/GoogleOAuthProvider.js";

const getGmailClient = async () => {
  const auth = await getAuthClient();
  return google.gmail({ version: "v1", auth });
};

/**
 * Encodes email fields into RFC 2822 format, base64url-encoded for Gmail API.
 */
const buildRawEmail = ({
  to,
  cc,
  bcc,
  subject,
  body,
  inReplyTo,
  references,
}) => {
  const lines = [];

  lines.push(`To: ${to.join(", ")}`);
  if (cc && cc.length) lines.push(`Cc: ${cc.join(", ")}`);
  if (bcc && bcc.length) lines.push(`Bcc: ${bcc.join(", ")}`);
  lines.push(`Subject: ${subject}`);
  lines.push(`Content-Type: text/plain; charset=utf-8`);
  lines.push(`MIME-Version: 1.0`);

  // Threading headers — required for Gmail to attach reply to correct thread
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);

  lines.push(""); // blank line separates headers from body
  lines.push(body);

  const raw = lines.join("\r\n");

  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

/**
 * Sends an email immediately.
 * Returns { success: true, messageId, threadId }
 *      or { success: false, error, errorCode, retryable }
 */
const sendEmail = async ({
  to,
  cc = [],
  bcc = [],
  subject,
  body,
  threadId = null,
  inReplyTo = null,
  references = null,
}) => {
  try {
    if (!to || to.length === 0) {
      throw new Error("Cannot send email: no recipients specified");
    }

    const gmail = await getGmailClient();
    const raw = buildRawEmail({
      to,
      cc,
      bcc,
      subject,
      body,
      inReplyTo,
      references,
    });

    const requestBody = { raw };
    if (threadId) requestBody.threadId = threadId;

    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody,
    });

    return {
      success: true,
      messageId: response.data.id,
      threadId: response.data.threadId,
    };
  } catch (err) {
    console.error("[gmailSendService.sendEmail] Error:", err.message);

    const status =
      err.code || err.status || (err.response && err.response.status);
    return {
      success: false,
      error: err.message,
      errorCode: status,
      retryable: status === 429 || status === 500 || status === 503,
    };
  }
};

/**
 * Saves an email as a Gmail draft without sending.
 * Returns { success: true, draftId, messageId }
 *      or { success: false, error, errorCode, retryable }
 */
const saveDraft = async ({
  to,
  cc = [],
  bcc = [],
  subject,
  body,
  threadId = null,
  inReplyTo = null,
  references = null,
}) => {
  try {
    const gmail = await getGmailClient();
    const raw = buildRawEmail({
      to,
      cc,
      bcc,
      subject,
      body,
      inReplyTo,
      references,
    });

    const requestBody = {
      message: { raw },
    };
    if (threadId) requestBody.message.threadId = threadId;

    const response = await gmail.users.drafts.create({
      userId: "me",
      requestBody,
    });

    return {
      success: true,
      draftId: response.data.id,
      messageId: response.data.message && response.data.message.id,
    };
  } catch (err) {
    console.error("[gmailSendService.saveDraft] Error:", err.message);

    const status =
      err.code || err.status || (err.response && err.response.status);
    return {
      success: false,
      error: err.message,
      errorCode: status,
      retryable: status === 429 || status === 500 || status === 503,
    };
  }
};

export const gmailSendService = { sendEmail, saveDraft };
