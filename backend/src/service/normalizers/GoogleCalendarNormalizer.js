import { logger } from "../../utils/logger.js";

export class GoogleCalendarNormalizer {
  /**
   * Normalize a batch of raw Google Calendar events
   */
  normalizeBatch(rawEvents, userId) {
    return rawEvents
      .map((event) => this.normalize(event, userId))
      .filter((doc) => doc !== null);
  }

  /**
   * Normalize a single Google Calendar event to the unified document format
   */
  normalize(rawEvent, userId) {
    try {
      // Skip cancelled events — they carry no useful content
      if (rawEvent.status === "cancelled") {
        return null;
      }

      const isAllDay = Boolean(rawEvent.start?.date && !rawEvent.start?.dateTime);
      const startTime = isAllDay
        ? new Date(`${rawEvent.start.date}T00:00:00`)
        : new Date(rawEvent.start.dateTime);
      const endTime = isAllDay
        ? new Date(`${rawEvent.end.date}T00:00:00`)
        : new Date(rawEvent.end.dateTime);

      const attendees = (rawEvent.attendees || []).map((a) => ({
        email: a.email,
        displayName: a.displayName || null,
        responseStatus: a.responseStatus || "needsAction",
        self: a.self || false,
      }));

      const content = this.buildContent(rawEvent, attendees, isAllDay);

      if (!content || content.trim().length === 0) {
        logger.warn(`Empty content for event ${rawEvent.id}, skipping`);
        return null;
      }

      return {
        documentId: `calendar_${rawEvent.id}`,
        userId,
        source: "calendar",
        type: "event",
        content,
        contentLength: content.length,
        title: rawEvent.summary || "(No Title)",
        timestamp: startTime,
        author: rawEvent.organizer?.email || null,
        metadata: {
          calendar: {
            event_id: rawEvent.id,
            calendar_id: "primary",
            summary: rawEvent.summary || "",
            description: rawEvent.description || "",
            location: rawEvent.location || "",
            start_time: startTime,
            end_time: endTime,
            attendees,
            organizer: rawEvent.organizer || null,
            recurrence: rawEvent.recurrence || null,
            is_all_day: isAllDay,
            html_link: rawEvent.htmlLink || null,
            conference_data: rawEvent.conferenceData || null,
          },
        },
        indexed: false,
        embeddingId: null,
        syncAttempts: 0,
        lastSyncError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      logger.error(
        `Failed to normalize calendar event ${rawEvent?.id}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Build a plain-text content string that is useful for embedding and RAG retrieval
   */
  buildContent(rawEvent, attendees, isAllDay) {
    const parts = [];

    parts.push(`Event: ${rawEvent.summary || "(No Title)"}`);

    const startLabel = isAllDay
      ? rawEvent.start.date
      : new Date(rawEvent.start.dateTime).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "full",
          timeStyle: "short",
        });
    const endLabel = isAllDay
      ? rawEvent.end.date
      : new Date(rawEvent.end.dateTime).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "full",
          timeStyle: "short",
        });

    parts.push(`Start: ${startLabel}`);
    parts.push(`End: ${endLabel}`);

    if (rawEvent.location) {
      parts.push(`Location: ${rawEvent.location}`);
    }

    if (rawEvent.description) {
      parts.push(`Description: ${this.cleanText(rawEvent.description)}`);
    }

    if (attendees.length > 0) {
      const attendeeList = attendees
        .map((a) => (a.displayName ? `${a.displayName} <${a.email}>` : a.email))
        .join(", ");
      parts.push(`Attendees: ${attendeeList}`);
    }

    if (rawEvent.organizer?.email) {
      parts.push(`Organizer: ${rawEvent.organizer.displayName || rawEvent.organizer.email}`);
    }

    if (rawEvent.recurrence) {
      parts.push(`Recurring: yes`);
    }

    return parts.join("\n");
  }

  /**
   * Strip HTML and normalize whitespace from description fields
   */
  cleanText(text) {
    if (!text) return "";
    let cleaned = text
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length > 2000) {
      cleaned = cleaned.substring(0, 2000) + "... [truncated]";
    }

    return cleaned;
  }
}
