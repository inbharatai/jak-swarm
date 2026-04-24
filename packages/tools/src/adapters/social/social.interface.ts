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
  /**
   * Legacy overall success flag. Kept for backward compat with callers
   * that read only this field — but callers SHOULD branch on `posted`
   * instead, since `success: true` with `draft` present means "draft
   * created, nothing actually published".
   */
  success: boolean;
  /**
   * True when the content actually went live on the platform. False when
   * only a draft was created (adapter was draft-only or platform write
   * failed). Added Stage 1.4 so callers cannot mistake a draft for a
   * real post.
   */
  posted: boolean;
  /** True when an editable draft exists locally / in the adapter. */
  draftCreated: boolean;
  postId?: string;
  url?: string;
  draft?: { text: string; platform: string; formattedForPlatform: boolean };
  error?: string;
}
