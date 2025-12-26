import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActionItem } from '../interfaces/action-item.interface';

export interface ConversationResponseDto {
    id: string;
    project_id: string;
    pm_id: string;
    conversation_date: string;
    title: string;
    summary?: string;
    action_items?: ActionItem[];
    sentiment?: string;
    audio_file_url?: string;
    status: string;
    processing_cost?: number;
    created_at: string;
    updated_at: string;
}

export interface PaginatedConversationsResponseDto {
    conversations: ConversationResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
}
