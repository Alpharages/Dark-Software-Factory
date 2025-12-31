import { AdrStatus, RiskLevel } from '@/prisma/client';

export interface TicketContextDto {
    id: string;
    title: string;
    clickup_task_id: string | null;
}

export interface AdrQueueItemDto {
    id: string;
    title: string;
    status: AdrStatus;
    risk_level: RiskLevel | null;
    ai_confidence: number;
    created_at: Date;
    estimated_review_time_minutes: number;
    ticket: TicketContextDto | null;
    execution_id: string | null;
}

export interface AdrReviewQueueResponseDto {
    items: AdrQueueItemDto[];
    total: number;
}
