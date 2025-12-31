/**
 * Response DTO for ADR review action
 * Returned when TL/ADMIN performs review action (approve/reject/modify/defer)
 */
export interface AdrReviewResponseDto {
    success: boolean;
    message: string;
    adr: {
        id: string;
        title: string;
        status: string;
        updated_at: Date;
    };
}
