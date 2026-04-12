/**
 * Twitter/X API v2 adapter.
 * Supports OAuth 1.0a for posting tweets.
 * Requires: TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
 */

import type { SocialMediaAdapter, SocialPostInput, SocialPostResult } from './social.interface.js';
import crypto from 'crypto';

const TWITTER_API_BASE = 'https://api.twitter.com';

export class TwitterApiAdapter implements SocialMediaAdapter {
  readonly platform = 'twitter';
  private apiKey: string;
  private apiSecret: string;
  private accessToken: string;
  private accessSecret: string;

  constructor(config: {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessSecret: string;
  }) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.accessToken = config.accessToken;
    this.accessSecret = config.accessSecret;
  }

  isDraft(): boolean {
    return false;
  }

  async post(content: SocialPostInput): Promise<SocialPostResult> {
    const text = this.formatTweet(content);

    const url = `${TWITTER_API_BASE}/2/tweets`;
    const authHeader = this.buildOAuthHeader('POST', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      return { success: false, error: `Twitter API error ${response.status}: ${err}` };
    }

    const data = await response.json() as { data?: { id: string } };
    const tweetId = data.data?.id;

    return {
      success: true,
      postId: tweetId,
      url: tweetId ? `https://twitter.com/i/web/status/${tweetId}` : undefined,
    };
  }

  private formatTweet(content: SocialPostInput): string {
    let text = content.text;
    if (content.hashtags?.length) {
      const tags = content.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
      text = `${text}\n\n${tags}`;
    }
    if (content.link) {
      text = `${text}\n${content.link}`;
    }
    // Twitter limit: 280 characters
    return text.slice(0, 280);
  }

  private buildOAuthHeader(method: string, url: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');

    const params: Record<string, string> = {
      oauth_consumer_key: this.apiKey,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: this.accessToken,
      oauth_version: '1.0',
    };

    const paramString = Object.keys(params)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]!)}`)
      .join('&');

    const signatureBase = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
    const signingKey = `${encodeURIComponent(this.apiSecret)}&${encodeURIComponent(this.accessSecret)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');

    params['oauth_signature'] = signature;

    const header = Object.keys(params)
      .sort()
      .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(params[k]!)}"`)
      .join(', ');

    return `OAuth ${header}`;
  }
}
