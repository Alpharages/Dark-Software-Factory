export class NoEligibleAccountError extends Error {
  constructor(provider: string, runtime: string) {
    super(`No eligible AI account for provider "${provider}" and runtime "${runtime}".`);
    this.name = 'NoEligibleAccountError';
  }
}
