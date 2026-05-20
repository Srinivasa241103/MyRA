import nodemailer from "nodemailer";
import "dotenv/config";
import { logger } from "./logger.js";
export default class Mailer {
  constructor() {
    this.transporter = null;
    this.fromAddress = null;
    this.initialized = false;
  }

  _init() {
    if (this.initialized) return;
    const user = process.env.MAIL_USER;
    const pass = process.env.MAIL_APP_PASSWORD;

    if (!user || !pass) {
      throw new Error(
        "Mailer not configured: MAIL_USER and MAIL_APP_PASSWORD must be set in .env"
      );
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_SMTP_HOST,
      port: Number(process.env.MAIL_SMTP_PORT),
      secure: false,
      auth: { user, pass },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
    });

    const fromName = process.env.MAIL_FROM_NAME || "MyRA";
    const fromEMail = process.env.MAIL_FROM_ADDRESS || user;
    this.fromAddress = `"${fromName}" <${fromEMail}>`;
    this.initialized = true;
  }

  /**
   * Send an email.
   * @param {Object} options
   * @param {string|string[]} options.to     Recipient(s)
   * @param {string} options.subject         Email subject line
   * @param {string} options.html            HTML body
   * @param {string} [options.text]          Plain text fallback (auto-generated if omitted)
   * @param {string} [options.from]          Override default from address
   * @param {Array}  [options.attachments]   Nodemailer attachments array
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async sendMail({ to, subject, html, text, from, attachments }) {
    try {
      this._init();
      if (!to || !subject || !html) {
        throw new Error(
          'Mailer.send requires "to", "subject", and "html" fields'
        );
      }
      const info = await this.transporter.sendMail({
        from: from || this.fromAddress,
        to,
        subject,
        html,
        text: text || this._stripHtml(html),
        attachments,
      });
      logger.info("Email sent", { to, subject, messageId: info.messageId });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error("Error sending email:", error);
      return { success: false, error: error.message };
    }
  }

  async verify() {
    try {
      this._init();
      await this.transporter.verify();
      logger.info("Mailer verification successful");
      return true;
    } catch (error) {
      logger.error("Mailer verification failed", error);
      return false;
    }
  }

  _stripHtml(html) {
    return html
      .replace(/<style[^>]*>.*?<\/style>/gis, "")
      .replace(/<script[^>]*>.*?<\/script>/gis, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
