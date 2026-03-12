import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IntegrationProvider, ProjectIntegration } from '@prisma/client';
import { IPMProvider } from './pm-provider.interface';
import { ClickUpProvider } from './clickup/clickup.provider';
import { ProjectIntegrationService } from '../project-integration.service';
import { UnsupportedProviderException } from '../../common/exceptions/unsupported-provider.exception';
import { IntegrationAuthException } from '../../common/exceptions/integration-auth.exception';

@Injectable()
export class PMProviderFactory {
  private readonly logger = new Logger(PMProviderFactory.name);

  constructor(
    private readonly integrationService: ProjectIntegrationService,
    private readonly config: ConfigService,
  ) {}

  async getProvider(integration: ProjectIntegration): Promise<IPMProvider> {
    let activeIntegration = integration;

    // Transparent Refresh: trigger within 5-minute expiry window
    if (
      activeIntegration.token_expiry !== null &&
      Date.now() + 300_000 > activeIntegration.token_expiry.getTime()
    ) {
      this.logger.log({
        message: 'Token near expiry, refreshing',
        integrationId: integration.id,
        provider: integration.provider,
      });
      activeIntegration = await this.refreshTokens(activeIntegration);
    }

    if (!activeIntegration.access_token) {
      throw new IntegrationAuthException(
        activeIntegration.id,
        new Error('No access token available'),
      );
    }

    switch (activeIntegration.provider) {
      case IntegrationProvider.CLICKUP:
        return new ClickUpProvider(activeIntegration.access_token);
      default:
        throw new UnsupportedProviderException(String(activeIntegration.provider));
    }
  }

  private async refreshTokens(integration: ProjectIntegration): Promise<ProjectIntegration> {
    if (integration.provider !== IntegrationProvider.CLICKUP) {
      return integration;
    }

    // Guard: refresh_token must be present before attempting OAuth
    if (!integration.refresh_token) {
      throw new IntegrationAuthException(
        integration.id,
        new Error('No refresh token available — cannot refresh'),
      );
    }

    const clientId = this.config.get<string>('clickup.clientId');
    const clientSecret = this.config.get<string>('clickup.clientSecret');

    if (!clientId || !clientSecret) {
      this.logger.warn({
        message: 'OAuth credentials not configured, cannot refresh token',
        integrationId: integration.id,
        provider: integration.provider,
      });
      throw new IntegrationAuthException(
        integration.id,
        new Error('OAuth credentials not configured'),
      );
    }

    try {
      const response = await axios.post<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
      }>('https://api.clickup.com/api/v2/oauth/token', null, {
        params: {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: integration.refresh_token,
        },
      });

      const { access_token, refresh_token, expires_in } = response.data;
      const token_expiry = new Date(Date.now() + expires_in * 1000);

      const updated = await this.integrationService.updateIntegration(integration.id, {
        access_token,
        refresh_token,
        token_expiry,
      });

      this.logger.log({
        message: 'Token refreshed successfully',
        integrationId: integration.id,
        provider: integration.provider,
      });

      return updated;
    } catch (error) {
      if (error instanceof IntegrationAuthException) throw error;
      this.logger.error({
        message: 'Token refresh HTTP call failed',
        integrationId: integration.id,
        provider: integration.provider,
        error: error instanceof Error ? error.message : error,
      });
      throw new IntegrationAuthException(integration.id, error);
    }
  }
}
