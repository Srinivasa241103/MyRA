
const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 4000;

function extractDisplayFields(sourceType, sourceMetadata = {}) {
    switch (sourceType) {
        case 'gmail':
            return {
                title: sourceMetadata.subject || null,
                author: sourceMetadata.from || null,
            };
        case 'calendar':
            return {
                title: sourceMetadata.title || sourceMetadata.summary || null,
                author: sourceMetadata.organizer || null,
            };
        default:
            return {
                title: sourceMetadata.title || null,
                author: sourceMetadata.author || null,
            };
    }
}

function formatSource(result, index) {
    const { title, author } = extractDisplayFields(
        result.source_type,
        result.document?.metadata,
    );

    const dateStr = result.occurred_at
        ? new Date(result.occurred_at).toISOString().split('T')[0]
        : 'unknown date';

    // Build the header line with whichever fields are present.
    const headerParts = [`[Source ${index}]`, result.source_type, dateStr];
    if (author || result.document?.author) {
        headerParts.push(`from ${author || result.document.author}`);
    }
    if (title) {
        headerParts.push(`— ${title}`);
    }

    const header = headerParts.join(' ');
    return `${header}\n${result.content}`;
}


export const buildContext = (chunks, options = {}) => {
    const { maxTokens = DEFAULT_MAX_TOKENS } = options;

    if (!chunks || chunks.length === 0) {
        return 'Retrieved context:\nNo relevant context found in personal data.';
    }

    const maxChars = maxTokens * CHARS_PER_TOKEN;
    const sourceBlocks = [];
    let totalChars = 0;

    for (let i = 0; i < chunks.length; i++) {
        const block = formatSource(chunks[i], i + 1);

        // Always include at least one block, even if it overshoots the budget.
        if (sourceBlocks.length > 0 && totalChars + block.length > maxChars) {
            break;
        }

        sourceBlocks.push(block);
        totalChars += block.length;
    }

    return `Retrieved context:\n\n${sourceBlocks.join('\n\n---\n\n')}`;

}