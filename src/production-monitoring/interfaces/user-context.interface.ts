/**
 * User Context Interface
 * Story 9-U-4: Error Context Extraction & Linking
 */

export interface UserContext {
  /** User ID (if authenticated) */
  user_id?: string;
  /** Session ID */
  session_id?: string;
  /** Hashed IP address (anonymized for privacy) */
  ip_hash?: string;
  /** User agent (browser/device info) */
  user_agent?: string;
}
