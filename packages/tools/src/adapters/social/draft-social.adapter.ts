/**
 * Draft-only social media adapter.
 * Returns formatted content for human review instead of posting.
 * Used when API keys are not configured.
 */

import type { SocialMediaAdapter, SocialPostInput, SocialPostResult } from './social.interface.js';

export class DraftSocialAdapter implements SocialMediaAdapter {
  readonly platform: string;

  constructor(platform: string) {
    this.platform = platform;
  }

  isDraft(): boolean {
    return true;
  }

  async post(content: SocialPostInput): Promise<SocialPostResult> {
    let text = content.text;
    if (content.hashtags?.length) {
      const tags = content.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
      text = `${text}\n\n${tags}`;
    }
    if (content.link) {
      text = `${text}\n\n${content.link}`;
    }

    return {
      success: true,
      draft: {
        text,
        platform: this.platform,
        formattedForPlatform: true,
      },
    };
  }
}
