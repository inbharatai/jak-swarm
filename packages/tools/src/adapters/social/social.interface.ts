/**
 * Social media adapter interface.
 * Each platform implements this. When API keys aren't configured, the
 * DraftSocialAdapter returns draft content for human review instead.
 */

export interface SocialMediaAdapter {
  /** Post content to the platform. */
  post(content: SocialPostInput): Promise<SocialPostResult>;
  /** Whether this adapter only drafts (no real posting). */
  isDraft(): boolean;
  /** Platform identifier. */
  readonly platform: string;
}

export interface SocialPostInput {
  text: string;
  imagePath?: string;
  link?: string;
  hashtags?: string[];
  extra?: Record<string, unknown>;
}

export interface SocialPostResult {
  success: boolean;
  postId?: string;
  url?: string;
  draft?: { text: string; platform: string; formattedForPlatform: boolean };
  error?: string;
}
