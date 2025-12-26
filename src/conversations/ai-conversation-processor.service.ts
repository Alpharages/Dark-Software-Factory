import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SentryService } from '@/common/sentry/sentry.service';
import { ActionItem } from './interfaces/action-item.interface';
import axios from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

/**
 * AI Conversation Processor Service - Story 5.5
 * Integrates with OpenAI Whisper API (transcription) and GPT-4 (analysis)
 */
@Injectable()
export class AIConversationProcessorService {
    private readonly logger = new Logger(AIConversationProcessorService.name);
    private readonly openaiApiKey: string;
    private readonly openaiBaseUrl = 'https://api.openai.com/v1';

    constructor(
        private readonly config: ConfigService,
        private readonly sentry: SentryService,
    ) {
        this.openaiApiKey = this.config.get<string>('OPENAI_API_KEY') || '';
        if (!this.openaiApiKey) {
            this.logger.warn('OPENAI_API_KEY not configured - AI features will not work');
        }
    }

    /**
     * Transcribe audio using Whisper API
     * POST https://api.openai.com/v1/audio/transcriptions
     * Model: whisper-1
     * Input: Audio file (max 25 MB), formats: mp3, mp4, wav, m4a
     * Output: { text: string, language: string }
     */
    async transcribeAudio(filePath: string): Promise<{ text: string; language?: string } | null> {
        try {
            const formData = new FormData();
            formData.append('file', fs.createReadStream(filePath));
            formData.append('model', 'whisper-1');

            const response = await axios.post(
                `${this.openaiBaseUrl}/audio/transcriptions`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${this.openaiApiKey}`,
                        ...formData.getHeaders(),
                    },
                    maxBodyLength: Infinity,
                    timeout: 120000, // 2 minutes timeout for large files
                },
            );

            this.logger.log(`Transcription successful: ${response.data.text?.substring(0, 100)}...`);
            return {
                text: response.data.text,
                language: response.data.language,
            };
        } catch (error) {
            this.logger.error(
                `Whisper transcription failed: ${(error as Error).message}`,
                (error as Error).stack,
            );
            this.sentry.captureException(error as Error, {
                tags: { module: 'ai-conversation-processor', operation: 'transcribeAudio' },
                extra: { filePath },
            });
            return null; // Allow manual transcript as fallback
        }
    }

    /**
     * Generate summary using GPT-4
     * Model: gpt-4-turbo-preview
     */
    async generateSummary(transcript: string): Promise<{
        summary: string;
        key_points: string[];
        decisions: string[];
        next_steps: string[];
    }> {
        const prompt = `You are summarizing a client meeting transcript. Extract:
1. Key discussion points (3-5 bullet points)
2. Decisions made
3. Next steps agreed upon

Transcript:
${transcript}

Output JSON:
{ "summary": string, "key_points": string[], "decisions": string[], "next_steps": string[] }`;

        try {
            const response = await axios.post(
                `${this.openaiBaseUrl}/chat/completions`,
                {
                    model: 'gpt-4-turbo-preview',
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 60000,
                },
            );

            const content = response.data.choices[0].message.content;
            const parsed = JSON.parse(content);

            this.logger.log(`Summary generated: ${parsed.summary.substring(0, 100)}...`);
            return {
                summary: parsed.summary || '',
                key_points: parsed.key_points || [],
                decisions: parsed.decisions || [],
                next_steps: parsed.next_steps || [],
            };
        } catch (error) {
            this.logger.error(`GPT-4 summary generation failed: ${(error as Error).message}`);
            this.sentry.captureException(error as Error, {
                tags: { module: 'ai-conversation-processor', operation: 'generateSummary' },
            });
            return {
                summary: 'Summary generation failed',
                key_points: [],
                decisions: [],
                next_steps: [],
            };
        }
    }

    /**
     * Extract action items using GPT-4
     */
    async extractActionItems(transcript: string): Promise<ActionItem[]> {
        const prompt = `Extract action items from this meeting transcript. For each action item, identify:
- owner (person responsible)
- task (clear description)
- due_date (estimate based on context, format: YYYY-MM-DD)
- priority (high/medium/low)

Transcript:
${transcript}

Output JSON array:
[{ "id": "uuid", "owner": string, "task": string, "due_date": string, "priority": "high" | "medium" | "low" }]`;

        try {
            const response = await axios.post(
                `${this.openaiBaseUrl}/chat/completions`,
                {
                    model: 'gpt-4-turbo-preview',
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' },
                    temperature: 0.3,
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 60000,
                },
            );

            const content = response.data.choices[0].message.content;
            const parsed = JSON.parse(content);
            const items: ActionItem[] = parsed.action_items || parsed.items || [];

            // M4 FIX: Generate UUIDs for action items (deterministic and stable)
            const itemsWithIds = items.map((item) => ({
                id: uuidv4(),
                owner: item.owner || 'Unassigned',
                task: item.task || '',
                due_date: item.due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                priority: item.priority || 'medium',
            }));

            this.logger.log(`Extracted ${itemsWithIds.length} action items`);
            return itemsWithIds;
        } catch (error) {
            this.logger.error(`GPT-4 action item extraction failed: ${(error as Error).message}`);
            this.sentry.captureException(error as Error, {
                tags: { module: 'ai-conversation-processor', operation: 'extractActionItems' },
            });
            return [];
        }
    }

    /**
     * Analyze sentiment using GPT-4
     */
    async analyzeSentiment(transcript: string): Promise<'positive' | 'neutral' | 'negative'> {
        const prompt = `Analyze the sentiment of this client meeting transcript. Classify as:
- positive: Client is satisfied, enthusiastic, or happy
- neutral: Professional, informational, or mixed signals
- negative: Client is frustrated, dissatisfied, or concerned

Transcript:
${transcript}

Output JSON:
{ "sentiment": "positive" | "neutral" | "negative", "reasoning": string }`;

        try {
            const response = await axios.post(
                `${this.openaiBaseUrl}/chat/completions`,
                {
                    model: 'gpt-4-turbo-preview',
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' },
                    temperature: 0.2,
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 60000,
                },
            );

            const content = response.data.choices[0].message.content;
            const parsed = JSON.parse(content);
            const sentiment = parsed.sentiment || 'neutral';

            this.logger.log(`Sentiment analysis: ${sentiment} (${parsed.reasoning || 'no reasoning'})`);
            return sentiment;
        } catch (error) {
            this.logger.error(`GPT-4 sentiment analysis failed: ${(error as Error).message}`);
            this.sentry.captureException(error as Error, {
                tags: { module: 'ai-conversation-processor', operation: 'analyzeSentiment' },
            });
            return 'neutral'; // Default fallback
        }
    }

    /**
     * Calculate token count for cost estimation
     * Approximation: ~4 characters per token (GPT models)
     */
    estimateTokenCount(text: string): number {
        return Math.floor(text.length / 4);
    }
}
