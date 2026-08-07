/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';

export type BuiltInOAuthProvider =
  'codex' | 'anthropic' | 'antigravity' | 'kimi' | 'kimi-ai' | 'xai' | 'devin' | 'meta';

export interface OAuthStartResponse {
  url: string;
  state?: string;
  user_code?: string;
  flow?: string;
  expires_in?: number;
  /** True when the server issued a manual-redirect authorization URL. */
  manual?: boolean;
}

export interface StartAuthOptions {
  /**
   * Force the manual redirect flow on or off instead of following the server
   * default. Only Anthropic honors this today; other providers ignore it.
   */
  manual?: boolean;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface OAuthCancelResponse {
  status: 'ok';
  cancelled: boolean;
}

const WEBUI_SUPPORTED = new Set<string>(['codex', 'claude', 'antigravity', 'xai', 'devin']);
const MANUAL_MODE_SUPPORTED = new Set<string>(['claude']);

const normalizeProviderForManagementPath = (provider: string): string => {
  const key = normalizeManagementOAuthProviderKey(provider);
  if (!isManagementOAuthProviderKey(key)) {
    throw new Error('Invalid OAuth provider');
  }
  return key === 'anthropic' ? 'claude' : key;
};

/**
 * Builds the query parameters for a login start request. The manual flag is only
 * meaningful for providers that expose both redirect flows, and is omitted entirely
 * when unset so the server-side default applies.
 */
export function buildOAuthStartParams(
  providerKey: string,
  options?: StartAuthOptions
): Record<string, string | boolean> {
  const params: Record<string, string | boolean> = { provider: providerKey };
  if (WEBUI_SUPPORTED.has(providerKey)) {
    params.is_webui = true;
  }
  if (MANUAL_MODE_SUPPORTED.has(providerKey) && options?.manual !== undefined) {
    params.manual = options.manual;
  }
  return params;
}

export const oauthApi = {
  startAuth: (provider: string, signal?: AbortSignal, options?: StartAuthOptions) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const params = buildOAuthStartParams(providerKey, options);
    return apiClient.get<OAuthStartResponse>('/oauth/auth-url', {
      params,
      ...(signal ? { signal } : {}),
    });
  },

  getAuthStatus: (state: string, signal?: AbortSignal) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/oauth/status`, {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  cancelSession: (state: string, signal?: AbortSignal) =>
    apiClient.delete<OAuthCancelResponse>('/oauth/session', {
      params: { state },
      ...(signal ? { signal } : {}),
    }),

  submitCallback: (provider: string, redirectUrl: string, signal?: AbortSignal) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    return apiClient.post<OAuthCallbackResponse>(
      '/oauth/callback',
      { provider: providerKey, redirect_url: redirectUrl },
      signal ? { signal } : undefined
    );
  },
};
