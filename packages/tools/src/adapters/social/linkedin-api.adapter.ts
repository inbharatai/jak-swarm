/**
 * LinkedIn API v2 adapter for posting.
 * Requires: LINKEDIN_ACCESS_TOKEN (OAuth2 bearer token)
 *
 * Note: LinkedIn requires a Company Page or personal profile URN.
 * Set LINKEDIN_PERSON_URN (e.g., "urn:li:person:XXXXX") to post as yourself.
 */

import type { SocialMediaAdapter, SocialPostInput, SocialPostResult } from './social.interface.js';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

export class LinkedInApiAdapter implements SocialMediaAdapter {
  readonly platform = 'linkedin';
  private accessToken: string;
  private personUrn: string;

  constructor(config: { accessToken: string; personUrn: string }) {
    this.accessToken = config.accessToken;
    this.personUrn = config.personUrn;
  }

  isDraft(): boolean {
    return false;
  }

  async post(content: SocialPostInput): Promise<SocialPostResult> {
    const text = this.formatPost(content);

    const body: Record<string, unknown> = {
      author: this.personUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: content.link ? 'ARTICLE' : 'NONE',
          ...(content.link
            ? {
                media: [
                  {
                    status: 'READY',
                    originalUrl: content.link,
                  },
                ],
              }
            : {}),
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    };

    const response = await fetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      return {
        success: false,
        posted: false,
        draftCreated: false,
        error: `LinkedIn API error ${response.status}: ${err}`,
      };
    }

    const postId = response.headers.get('x-restli-id') ?? undefined;
    return {
      success: true,
      posted: true,
      draftCreated: false,
      postId,
      url: postId ? `https://www.linkedin.com/feed/update/${postId}` : undefined,
    };
  }

  private formatPost(content: SocialPostInput): string {
    let text = content.text;
    if (content.hashtags?.length) {
      const tags = content.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
      text = `${text}\n\n${tags}`;
    }
    // LinkedIn limit: 3000 characters
    return text.slice(0, 3000);
  }
}
