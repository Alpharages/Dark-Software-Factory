import {
  Project,
  Ticket,
  Execution,
  ExecutionLog,
  QAResult,
  GitHubInstallation,
  GitHubAccount,
  GitHubPush,
  Deployment,
  CostRecord,
  ProductionError,
  ProductionErrorCommit,
  Metric,
  AuditLog,
  ContextDocument,
  CoverageBaseline,
  ProjectCoverageConfig,
  WebhookEvent,
  AIDecisionLog,
  FileLock,
  FileLockQueue,
  AICostLog,
  TicketDependency,
  ApprovalRecord,
  ProductionApproval,
  BugEscape,
  AiCodeReview,
  AiCodeReviewFinding,
  User,
  UtilizationHistory,
  ClientConversation,
  Report,
  SystemConfig,
  Adr,
  AdrAlert,
  QaSamplingConfig,
  QaReviewQueue,
  NotificationPreference,
  InAppNotification,
  ArchitectureConstraint,
  AiCapability,
  AiTaskPattern,
  UserInvitation,
  RefreshToken,
  QualityGateConfig,
  QualityGateConfigHistory,
  QualityAnomaly,
  QualityAnomalyConfig,
  ExecutionOverride,
  ConnectedApp
} from '@prisma/client';

export * from '@prisma/client';

export * from './enums';

// Model Compatibility
export type ProjectModel = Project;
export type TicketModel = Ticket;
export type ExecutionModel = Execution;
export type ExecutionLogModel = ExecutionLog;
export type QAResultModel = QAResult;
export type GitHubInstallationModel = GitHubInstallation;
export type GitHubAccountModel = GitHubAccount;
export type GitHubPushModel = GitHubPush;
export type DeploymentModel = Deployment;
export type CostRecordModel = CostRecord;
export type ProductionErrorModel = ProductionError;
export type ProductionErrorCommitModel = ProductionErrorCommit;
export type MetricModel = Metric;
export type AuditLogModel = AuditLog;
export type ContextDocumentModel = ContextDocument;
export type CoverageBaselineModel = CoverageBaseline;
export type ProjectCoverageConfigModel = ProjectCoverageConfig;
export type WebhookEventModel = WebhookEvent;
export type AIDecisionLogModel = AIDecisionLog;
export type FileLockModel = FileLock;
export type FileLockQueueModel = FileLockQueue;
export type AICostLogModel = AICostLog;
export type TicketDependencyModel = TicketDependency;
export type ApprovalRecordModel = ApprovalRecord;
export type ProductionApprovalModel = ProductionApproval;
export type BugEscapeModel = BugEscape;
export type AiCodeReviewModel = AiCodeReview;
export type AiCodeReviewFindingModel = AiCodeReviewFinding;
export type UserModel = User;
export type UtilizationHistoryModel = UtilizationHistory;
export type ClientConversationModel = ClientConversation;
export type ReportModel = Report;
export type SystemConfigModel = SystemConfig;
export type AdrModel = Adr;
export type AdrAlertModel = AdrAlert;
export type QaSamplingConfigModel = QaSamplingConfig;
export type QaReviewQueueModel = QaReviewQueue;
export type NotificationPreferenceModel = NotificationPreference;
export type InAppNotificationModel = InAppNotification;
export type ArchitectureConstraintModel = ArchitectureConstraint;
export type AiCapabilityModel = AiCapability;
export type AiTaskPatternModel = AiTaskPattern;
export type UserInvitationModel = UserInvitation;
export type RefreshTokenModel = RefreshToken;
export type QualityGateConfigModel = QualityGateConfig;
export type QualityGateConfigHistoryModel = QualityGateConfigHistory;
export type QualityAnomalyModel = QualityAnomaly;
export type QualityAnomalyConfigModel = QualityAnomalyConfig;
export type ExecutionOverrideModel = ExecutionOverride;
export type ConnectedAppModel = ConnectedApp;

