import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { IAIExecutionResult } from './ai-provider.interface';

export interface ICodingAgentProvider {
  readonly providerName: ProviderName;
  readonly isEnabled: boolean;
  isHealthy(): Promise<boolean>;
  execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult>;
}
