export enum RejectionCategory {
    SECURITY = 'Security',
    PERFORMANCE = 'Performance',
    CONSTRAINTS = 'Constraints',
    CONTEXT = 'Context',
    OTHER = 'Other'
}

export function categorizeRejectionReason(reason: string): RejectionCategory {
    if (!reason) return RejectionCategory.OTHER;

    const r = reason.toLowerCase();
    if (r.includes('security') || r.includes('auth') || r.includes('vulnerability') || r.includes('credentials')) return RejectionCategory.SECURITY;
    if (r.includes('performance') || r.includes('slow') || r.includes('latency') || r.includes('memory') || r.includes('cpu')) return RejectionCategory.PERFORMANCE;
    if (r.includes('constraint') || r.includes('standard') || r.includes('pattern') || r.includes('structure') || r.includes('formatting')) return RejectionCategory.CONSTRAINTS;
    if (r.includes('context') || r.includes('requirement') || r.includes('missing') || r.includes('clarification') || r.includes('scope')) return RejectionCategory.CONTEXT;

    return RejectionCategory.OTHER;
}
