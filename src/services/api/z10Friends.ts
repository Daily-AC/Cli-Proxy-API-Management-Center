/**
 * z10 friend keys: restricted API keys handed to friends.
 *
 * The z10 build of CLIProxyAPI serves these endpoints at the server root (`/z10/...`),
 * outside the Management API prefix, behind the same management-key authentication.
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export interface Z10Channel {
  name: string;
  models: string[];
}

export type FriendInactiveReason = 'disabled' | 'expired' | '';

export interface FriendKey {
  name: string;
  models: string[];
  channels: string[];
  /** `YYYY-MM-DD` (or RFC3339); empty when the key never expires. */
  expires: string;
  enabled: boolean;
  active: boolean;
  inactiveReason: FriendInactiveReason;
  /** RFC3339; empty when the key has never been used. */
  lastUsed: string;
  requests: number;
  failedRequests: number;
  totalTokens: number;
}

export interface FriendCreateInput {
  name: string;
  channels: string[];
  /** Omitted: the server allows every model of the chosen channels. */
  models?: string[];
  expires?: string;
  enabled?: boolean;
}

export interface FriendUpdateInput {
  enabled?: boolean;
  /** An empty string clears the expiry. */
  expires?: string;
  channels?: string[];
  models?: string[];
}

export interface FriendCreateResult {
  friend: FriendKey;
  /** The only time the server ever returns the key. */
  key: string;
}

const SERVER_ROOT = { serverRoot: true } as const;

export const Z10_CHANNELS_PATH = '/z10/channels';
export const Z10_FRIENDS_PATH = '/z10/friends';

export const friendPath = (name: string) => `${Z10_FRIENDS_PATH}/${encodeURIComponent(name)}`;

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const asStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];

const asInactiveReason = (value: unknown): FriendInactiveReason =>
  value === 'disabled' || value === 'expired' ? value : '';

export const normalizeChannel = (value: unknown): Z10Channel | null => {
  if (!isRecord(value)) return null;
  const name = asString(value.name).trim();
  if (!name) return null;
  return { name, models: asStringList(value.models) };
};

export const normalizeFriend = (value: unknown): FriendKey | null => {
  if (!isRecord(value)) return null;
  const name = asString(value.name).trim();
  if (!name) return null;
  return {
    name,
    models: asStringList(value.models),
    channels: asStringList(value.channels),
    expires: asString(value.expires).trim(),
    enabled: value.enabled !== false,
    active: value.active === true,
    inactiveReason: asInactiveReason(value.inactive_reason),
    lastUsed: asString(value.last_used).trim(),
    requests: asCount(value.requests),
    failedRequests: asCount(value.failed_requests),
    totalTokens: asCount(value.total_tokens),
  };
};

const malformed = (what: string) => new Error(`Malformed ${what} response`);

const readFriend = (data: unknown): FriendKey => {
  const friend = isRecord(data) ? normalizeFriend(data.friend) : null;
  if (!friend) throw malformed('friend');
  return friend;
};

export const z10FriendsApi = {
  async listChannels(): Promise<Z10Channel[]> {
    const data = await apiClient.get<unknown>(Z10_CHANNELS_PATH, SERVER_ROOT);
    if (!isRecord(data) || !Array.isArray(data.channels)) throw malformed('channels');
    return data.channels.map(normalizeChannel).filter((item): item is Z10Channel => !!item);
  },

  async list(): Promise<FriendKey[]> {
    const data = await apiClient.get<unknown>(Z10_FRIENDS_PATH, SERVER_ROOT);
    if (!isRecord(data) || !Array.isArray(data.friends)) throw malformed('friends');
    return data.friends.map(normalizeFriend).filter((item): item is FriendKey => !!item);
  },

  async create(input: FriendCreateInput): Promise<FriendCreateResult> {
    const body: Record<string, unknown> = { name: input.name, channels: input.channels };
    if (input.models) body.models = input.models;
    if (input.expires) body.expires = input.expires;
    if (input.enabled !== undefined) body.enabled = input.enabled;
    const data = await apiClient.post<unknown>(Z10_FRIENDS_PATH, body, SERVER_ROOT);
    const key = isRecord(data) ? asString(data.key) : '';
    if (!key) throw malformed('create');
    return { friend: readFriend(data), key };
  },

  async update(name: string, patch: FriendUpdateInput): Promise<FriendKey> {
    const data = await apiClient.patch<unknown>(friendPath(name), patch, SERVER_ROOT);
    return readFriend(data);
  },

  async remove(name: string): Promise<void> {
    await apiClient.delete(friendPath(name), SERVER_ROOT);
  },
};
