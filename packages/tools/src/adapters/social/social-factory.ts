/**
 * Social media adapter factory.
 * Returns real API adapter when credentials are configured, draft adapter otherwise.
 */

import type { SocialMediaAdapter } from './social.interface.js';
import { DraftSocialAdapter } from './draft-social.adapter.js';
import { TwitterApiAdapter } from './twitter-api.adapter.js';
import { LinkedInApiAdapter } from './linkedin-api.adapter.js';

export function getTwitterAdapter(): SocialMediaAdapter {
  const apiKey = process.env['TWITTER_API_KEY'];
  const apiSecret = process.env['TWITTER_API_SECRET'];
  const accessToken = process.env['TWITTER_ACCESS_TOKEN'];
  const accessSecret = process.env['TWITTER_ACCESS_SECRET'];

  if (apiKey && apiSecret && accessToken && accessSecret) {
    return new TwitterApiAdapter({ apiKey, apiSecret, accessToken, accessSecret });
  }

  return new DraftSocialAdapter('twitter');
}

export function getLinkedInAdapter(): SocialMediaAdapter {
  const accessToken = process.env['LINKEDIN_ACCESS_TOKEN'];
  const personUrn = process.env['LINKEDIN_PERSON_URN'];

  if (accessToken && personUrn) {
    return new LinkedInApiAdapter({ accessToken, personUrn });
  }

  return new DraftSocialAdapter('linkedin');
}

export function getRedditAdapter(): SocialMediaAdapter {
  // Reddit requires OAuth2 — draft-only for now
  // Full Reddit API adapter would need: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
  return new DraftSocialAdapter('reddit');
}

export function getSocialAdapter(platform: string): SocialMediaAdapter {
  switch (platform.toLowerCase()) {
    case 'twitter':
    case 'x':
      return getTwitterAdapter();
    case 'linkedin':
      return getLinkedInAdapter();
    case 'reddit':
      return getRedditAdapter();
    default:
      return new DraftSocialAdapter(platform);
  }
}
