/**
 * Git Mirror Module Public API
 * Story 23.1: Local Git Mirror Service
 */

export { GitMirrorModule } from './git-mirror.module';
export { GitMirrorService } from './git-mirror.service';
export type {
  MirrorInfo,
  MirrorCloneOptions,
  MirrorCloneResult,
} from './interfaces/mirror-info.interface';
export type {
  MirrorMetadata,
  MirrorsMetadataFile,
  MirrorEvictionCandidate,
} from './interfaces/mirror-metadata.interface';
export {
  GitMirrorException,
  MirrorAuthError,
  MirrorNetworkError,
  MirrorCorruptedError,
  MirrorDiskSpaceError,
  MirrorLockTimeoutError,
} from './exceptions/git-mirror.exception';
