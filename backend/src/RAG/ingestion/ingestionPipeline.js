import GmailDataSource from '../../service/sources/GmailDataSource.js';
import GoogleCalendarDataSource from '../../service/sources/GoogleCalendarDataSource.js';
import { GmailNormalizer } from '../../service/normalizers/GmailNormalizer.js';
import { GoogleCalendarNormalizer } from '../../service/normalizers/GoogleCalendarNormalizer.js';
import { logger } from '../../utils/logger.js';
import { documentRepository } from '../../database/index.js';
import { SyncLogRepository } from '../../database/syncLogsRepository.js';

const SOURCES = {
    gmail: {
        source: GmailDataSource,
        normalizer: GmailNormalizer
    },
    calendar: {
        source: GoogleCalendarDataSource,
        normalizer: GoogleCalendarNormalizer
    }
}
export class IngestionPipeline {
    constructor() {
        this.syncRepo = new SyncLogRepository();
        this.documentRepo = documentRepository;
    }

    async runIngestion(sourceName, isFullSync, userId) {
        if (!userId) {
            throw new Error('User ID is required for ingestion');
        }

        if (!sourceName || !SOURCES[sourceName]) {
            throw new Error(`Invalid source: ${sourceName}. Valid sources are ${Object.keys(SOURCES).join(', ')}`);
        }

        const { source: SourceClass, normalizer: NormalizerClass } = SOURCES[sourceName];
        const source = new SourceClass(userId);
        const normalizer = new NormalizerClass();
        const response = {};
        let data;
        if (isFullSync) {
            data = await source.fetchAll({
                maxResults: 500
            });
            response.fetched = data.length;
        } else {
            const lastSyncLog = await this.syncRepo.getLastSuccessfulSync(sourceName);
            const since = lastSyncLog?.sync_completed_at || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            data = await source.fetchNew(since);
            response.fetched = data.length;
        }

        logger.info(`Fetched ${data.length} messages from ${sourceName}`);
        response.inserted = 0;
        response.skipped = 0;
        response.failed = 0;

        for (const item of data) {
            try {
                const doc = normalizer.normalize(item, userId);

                // Normalizer returns null for items it chooses to skip (e.g. empty content)
                if (!doc) {
                    response.skipped++;
                    continue;
                }

                const isExisting = await this.documentRepo.findByDocumentId(doc.documentId);
                if (isExisting) {
                    response.skipped++;
                    continue;
                }

                // Map camelCase normalizer output to snake_case DB columns
                await this.documentRepo.create({
                    document_id: doc.documentId,
                    source: doc.source,
                    type: doc.type,
                    content: doc.content,
                    title: doc.title,
                    timestamp: doc.timestamp,
                    author: doc.author,
                    metadata: doc.metadata,
                });
                response.inserted++;
            } catch (error) {
                logger.error(`Failed to process item ${item.id}:`, error);
                response.failed++;
            }
        }

        return response;
    }
}