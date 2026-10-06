import type { ReactNode } from 'react';
import type {
  FriendCreateInput,
  FriendKey,
  FriendUpdateInput,
  Z10Channel,
} from '@/services/api/z10Friends';
import { getErrorMessage, isRecord } from '@/utils/helpers';

type Translate = (key: string, options?: Record<string, unknown>) => string;

// ── Status ────────────────────────────────────────────────

export type FriendStatus = 'active' | 'disabled' | 'expired';
export type FriendStatusTone = 'success' | 'muted' | 'warning';

export const FRIEND_STATUS_META: Record<
  FriendStatus,
  { labelKey: string; tone: FriendStatusTone }
> = {
  active: { labelKey: 'friend_keys.status_active', tone: 'success' },
  disabled: { labelKey: 'friend_keys.status_disabled', tone: 'muted' },
  expired: { labelKey: 'friend_keys.status_expired', tone: 'warning' },
};

/** The server's `inactive_reason` wins; the flags are only a fallback for older responses. */
export const getFriendStatus = (
  friend: Pick<FriendKey, 'enabled' | 'active' | 'inactiveReason'>
): FriendStatus => {
  if (friend.inactiveReason) return friend.inactiveReason;
  if (!friend.enabled) return 'disabled';
  return friend.active ? 'active' : 'expired';
};

// ── Form ──────────────────────────────────────────────────

/** Same rule as the backend's friends.yaml validation. */
/** Mirrors the server: Unicode letters and digits plus `._-`, up to 64, not only dots. */
export const FRIEND_NAME_RE = /^(?!\.+$)[\p{L}\p{N}_.-]{1,64}$/u;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface FriendFormValues {
  name: string;
  channels: string[];
  /** `YYYY-MM-DD`, or empty for never. */
  expires: string;
}

export type FriendFormField = keyof FriendFormValues;
/** Values are i18n keys. */
export type FriendFormErrors = Partial<Record<FriendFormField, string>>;

export const EMPTY_FRIEND_FORM: FriendFormValues = { name: '', channels: [], expires: '' };

const pad2 = (value: number) => String(value).padStart(2, '0');

/** Local calendar date as `YYYY-MM-DD`, the format of `<input type="date">`. */
export const toDateInputValue = (ms: number): string => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const isValidDateOnly = (value: string): boolean => {
  if (!DATE_ONLY_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

/** Maps saved channel names onto the server's spelling (names match case-insensitively). */
const canonicalChannels = (selected: string[], channels: Z10Channel[]): string[] => {
  const byLower = new Map(channels.map((channel) => [channel.name.toLowerCase(), channel.name]));
  return selected.map((name) => byLower.get(name.toLowerCase()) ?? name);
};

export const friendToFormValues = (
  friend: FriendKey,
  channels: Z10Channel[]
): FriendFormValues => ({
  name: friend.name,
  channels: canonicalChannels(friend.channels, channels),
  expires: /^\d{4}-\d{2}-\d{2}/.test(friend.expires) ? friend.expires.slice(0, 10) : '',
});

export interface FriendChannelOption extends Z10Channel {
  /** Saved on the key but no longer offered by the server. */
  missing: boolean;
}

export const buildChannelOptions = (
  channels: Z10Channel[],
  selected: string[]
): FriendChannelOption[] => {
  const known = new Set(channels.map((channel) => channel.name.toLowerCase()));
  return [
    ...channels.map((channel) => ({ ...channel, missing: false })),
    ...selected
      .filter((name) => !known.has(name.toLowerCase()))
      .map((name) => ({ name, models: [], missing: true })),
  ];
};

export interface FriendFormContext {
  mode: 'create' | 'edit';
  existingNames: string[];
  /** `YYYY-MM-DD` of today. */
  today: string;
  /** Edit mode: an unchanged (possibly past) expiry is never an error. */
  initialExpires?: string;
}

export const validateFriendForm = (
  values: FriendFormValues,
  context: FriendFormContext
): FriendFormErrors => {
  const errors: FriendFormErrors = {};

  if (context.mode === 'create') {
    const name = values.name.trim();
    if (!name) errors.name = 'friend_keys.error_name_required';
    else if (!FRIEND_NAME_RE.test(name)) errors.name = 'friend_keys.error_name_invalid';
    else if (context.existingNames.includes(name)) errors.name = 'friend_keys.error_name_taken';
  }

  if (values.channels.length === 0) errors.channels = 'friend_keys.error_channels_required';

  const expires = values.expires.trim();
  if (expires && expires !== context.initialExpires) {
    if (!isValidDateOnly(expires)) errors.expires = 'friend_keys.error_expires_invalid';
    else if (expires < context.today) errors.expires = 'friend_keys.error_expires_past';
  }

  return errors;
};

/** Models are never sent: the server allows every model of the chosen channels. */
export const buildCreateInput = (values: FriendFormValues): FriendCreateInput => {
  const expires = values.expires.trim();
  return {
    name: values.name.trim(),
    channels: [...values.channels],
    ...(expires ? { expires } : {}),
  };
};

const sameSet = (left: string[], right: string[]) => {
  const a = new Set(left.map((item) => item.toLowerCase()));
  const b = new Set(right.map((item) => item.toLowerCase()));
  return a.size === b.size && [...a].every((item) => b.has(item));
};

/** Only changed fields; an expiry cleared in the form is sent as `""`. */
export const buildUpdateInput = (
  initial: FriendFormValues,
  values: FriendFormValues
): FriendUpdateInput => {
  const patch: FriendUpdateInput = {};
  if (!sameSet(initial.channels, values.channels)) patch.channels = [...values.channels];
  const expires = values.expires.trim();
  if (expires !== initial.expires) patch.expires = expires;
  return patch;
};

// ── Errors ────────────────────────────────────────────────

export const getErrorStatus = (error: unknown): number | undefined =>
  isRecord(error) && typeof error.status === 'number' ? error.status : undefined;

/** Server `{"error": "..."}` text is already the ApiError message; 404/409 get fixed wording. */
export const friendErrorMessage = (error: unknown, t: Translate, fallbackKey: string): string => {
  const status = getErrorStatus(error);
  if (status === 404) return t('friend_keys.error_not_found');
  if (status === 409) return t('friend_keys.error_name_taken');
  return getErrorMessage(error, t(fallbackKey));
};

// ── Dialogs ───────────────────────────────────────────────

/**
 * The created key lives only in the `created` state. Closing drops it: nothing else
 * holds it, and nothing persists it.
 */
export type FriendDialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; friend: FriendKey }
  | { kind: 'created'; friend: FriendKey; key: string };

export type FriendDialogAction =
  | { type: 'open_create' }
  | { type: 'open_edit'; friend: FriendKey }
  | { type: 'created'; friend: FriendKey; key: string }
  | { type: 'close' };

export const CLOSED_DIALOG: FriendDialogState = { kind: 'closed' };

export const friendDialogReducer = (
  _state: FriendDialogState,
  action: FriendDialogAction
): FriendDialogState => {
  switch (action.type) {
    case 'open_create':
      return { kind: 'create' };
    case 'open_edit':
      return { kind: 'edit', friend: action.friend };
    case 'created':
      return { kind: 'created', friend: action.friend, key: action.key };
    case 'close':
      return CLOSED_DIALOG;
  }
};

// ── Delete ────────────────────────────────────────────────

export interface FriendDeleteDeps {
  t: Translate;
  showConfirmation: (options: {
    title?: string;
    message: ReactNode;
    confirmText?: string;
    variant?: 'danger' | 'primary' | 'secondary';
    onConfirm: () => void | Promise<void>;
  }) => void;
  remove: (name: string) => Promise<void>;
  notify: (message: string, type: 'success' | 'error') => void;
  /** Runs after the request settles, success or not (the list may have changed). */
  reload: () => void | Promise<void>;
}

/** Deletion always goes through the themed confirmation modal. */
export const requestFriendDelete = (friend: Pick<FriendKey, 'name'>, deps: FriendDeleteDeps) => {
  const { t } = deps;
  deps.showConfirmation({
    title: t('friend_keys.delete_confirm_title'),
    message: t('friend_keys.delete_confirm_message', { name: friend.name }),
    confirmText: t('common.delete'),
    variant: 'danger',
    onConfirm: async () => {
      try {
        await deps.remove(friend.name);
        deps.notify(t('friend_keys.delete_success', { name: friend.name }), 'success');
      } catch (error: unknown) {
        deps.notify(
          `${t('friend_keys.delete_failed')}: ${friendErrorMessage(error, t, 'friend_keys.delete_failed')}`,
          'error'
        );
      }
      await deps.reload();
    },
  });
};
