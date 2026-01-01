export class AdrEscalatedEvent {
    constructor(
        public readonly adrId: string,
        public readonly ticketId: string,
        public readonly executionId?: string,
        public readonly reason?: string,
    ) { }
}
