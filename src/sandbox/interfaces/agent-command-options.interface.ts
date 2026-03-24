export interface AgentCommandOptions {
  executionId: string; // Used for logging and tracking
  image: string; // Sandbox image (default: opensandbox/code-interpreter:v1.0.2)
  command: string; // Shell command to run (e.g., 'claude "implement feature X"')
  env: Record<string, string>; // Provider-specific env vars (API keys, model names)
  timeoutSeconds: number; // Per-execution TTL
  cpuLimit: string; // Kubernetes-style (e.g., "1", "0.5", "2")
  memoryLimit: string; // Kubernetes-style (e.g., "512Mi", "1Gi", "2Gi")
  networkPolicy?: {
    defaultAction: 'ALLOW' | 'DENY';
    egressRules?: Array<{ target: string }>;
  };
  metadata?: Record<string, string>; // Attached to sandbox for observability
  /** Optional: correlates sandbox execution to the parent ticket in ExecutionGateway log payloads */
  ticketId?: string;
}
