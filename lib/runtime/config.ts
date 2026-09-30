import { getAuthSecret } from '../auth/session.ts';
import { getCursorSigningSecret } from '../../shared/pagination.ts';

export function validateWebRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  getAuthSecret();
  getCursorSigningSecret();

  const appBaseUrl = env.APP_BASE_URL?.trim();
  if (!appBaseUrl) {
    throw new Error('Missing mandatory environment variable: APP_BASE_URL in production');
  }

  let parsed: URL;
  try {
    parsed = new URL(appBaseUrl);
  } catch {
    throw new Error('APP_BASE_URL must be an absolute URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use https:// in production');
  }
}
