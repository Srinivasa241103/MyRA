import { google } from "googleapis";
import BaseDataSource from "./BaseDataSource.js";
import { GoogleAuthService } from "../oauth/googleOAuthService.js";
import { logger } from "../../utils/logger.js";

async function getGoogleCalendarClient(userId) {
  const oauthService = new GoogleAuthService();
  const accessToken = await oauthService.getValidAccessToken(
    userId,
    "google_calendar"
  );
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

export default class GoogleCalendarDataSource extends BaseDataSource {
  constructor(userId) {
    super("google_calendar");
    this.userId = userId;
    this.oauthService = new GoogleAuthService();
    this.calendar = null;
  }

  getName() {
    return "Google Calendar";
  }

  getSource() {
    return this.source;
  }

  async initializeClient() {
    this.calendar = await getGoogleCalendarClient(this.userId);
    logger.info(`Google Calendar client initialized for user ${this.userId}`);
  }

  async validateConnection() {
    try {
      await this.initializeClient();
      await this.calendar.calendarList.list({ maxResults: 1 });
      this.setConnectionStatus(true);
      return true;
    } catch (error) {
      logger.error(`Calendar connection validation failed: ${error.message}`);
      this.setConnectionStatus(false);
      return false;
    }
  }

  /**
   * Fetch all calendar events (full sync)
   */
  async fetchAll(options = {}) {
    await this.initializeClient();

    const { maxResults = 500, timeMin = "2026-01-01T00:00:00Z" } = options;

    logger.info(
      `Fetching calendar events for user ${this.userId} from ${timeMin}`
    );

    const allEvents = [];
    let pageToken = null;

    try {
      do {
        const response = await this.calendar.events.list({
          calendarId: "primary",
          maxResults: Math.min(maxResults - allEvents.length, 250),
          pageToken,
          timeMin,
          singleEvents: true,
          orderBy: "startTime",
        });

        const events = response.data.items || [];
        allEvents.push(...events);
        pageToken = response.data.nextPageToken;

        logger.info(`Fetched ${allEvents.length} calendar events so far...`);

        if (allEvents.length >= maxResults) break;

        await this.sleep(100);
      } while (pageToken);

      logger.info(
        `Completed Calendar sync: ${allEvents.length} events fetched`
      );
      return allEvents;
    } catch (error) {
      logger.error(`Calendar fetchAll failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch new calendar events since last sync (incremental)
   */
  async fetchNew(since) {
    await this.initializeClient();
    logger.info(
      `Fetching new calendar events for user ${this.userId} since ${since.toISOString()}`
    );

    try {
      return this.fetchAll({
        timeMin: since.toISOString(),
        maxResults: 1000,
      });
    } catch (error) {
      logger.error(`Calendar incremental sync failed: ${error.message}`);
      throw error;
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
