import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentSkillRunner } from './agent-skill-runner.service';

/**
 * AgentSkillsModule
 *
 * Provides the AgentSkillRunner — the provider-agnostic LLM engine
 * that powers all agent skills in DSF.
 *
 * Import this module wherever you need to run an agent skill.
 * Skills themselves are plain classes (no NestJS coupling) —
 * instantiate them inline and pass to AgentSkillRunner.run().
 */
@Module({
  imports: [ConfigModule],
  providers: [AgentSkillRunner],
  exports: [AgentSkillRunner],
})
export class AgentSkillsModule {}
