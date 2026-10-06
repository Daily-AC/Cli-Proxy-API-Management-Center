import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconPencil, IconPlus, IconRefreshCw, IconTrash2 } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { z10FriendsApi, type FriendKey, type Z10Channel } from '@/services/api/z10Friends';
import { useAuthStore, useNotificationStore } from '@/stores';
import { formatCompactNumber } from '@/utils/format';
import { formatRelativeInstant } from '@/utils/quota';
import { getErrorMessage } from '@/utils/helpers';
import { FriendFormModal, type FriendFormSubmitResult } from './components/FriendFormModal';
import { FriendKeyResultModal } from './components/FriendKeyResultModal';
import {
  CLOSED_DIALOG,
  EMPTY_FRIEND_FORM,
  FRIEND_STATUS_META,
  buildCreateInput,
  buildUpdateInput,
  friendDialogReducer,
  friendErrorMessage,
  friendToFormValues,
  getErrorStatus,
  getFriendStatus,
  requestFriendDelete,
  toDateInputValue,
  type FriendFormValues,
} from './logic';
import styles from './FriendKeysPage.module.scss';

const BADGE_CLASS = {
  success: styles.badgeSuccess,
  muted: styles.badgeMuted,
  warning: styles.badgeWarning,
} as const;

const upsertFriend = (list: FriendKey[], friend: FriendKey) => {
  const index = list.findIndex((item) => item.name === friend.name);
  if (index === -1) return [...list, friend];
  return list.map((item, itemIndex) => (itemIndex === index ? friend : item));
};

export function FriendKeysPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const now = useNow();
  const connected = connectionStatus === 'connected';

  const [friends, setFriends] = useState<FriendKey[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [channels, setChannels] = useState<Z10Channel[] | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState('');
  const [togglingName, setTogglingName] = useState('');
  const [dialog, dispatchDialog] = useReducer(friendDialogReducer, CLOSED_DIALOG);
  const loadSeq = useRef(0);

  const loadFriends = useCallback(async () => {
    const seq = ++loadSeq.current;
    if (!connected) {
      setLoading(false);
      setError(t('notification.connection_required'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const list = await z10FriendsApi.list();
      if (seq === loadSeq.current) setFriends(list);
    } catch (err: unknown) {
      if (seq !== loadSeq.current) return;
      setError(
        getErrorStatus(err) === 404
          ? t('friend_keys.unsupported_backend')
          : `${t('friend_keys.load_failed')}: ${getErrorMessage(err, t('friend_keys.load_failed'))}`
      );
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [connected, t]);

  const loadChannels = useCallback(async () => {
    if (!connected) return;
    setChannelsLoading(true);
    setChannelsError('');
    try {
      setChannels(await z10FriendsApi.listChannels());
    } catch (err: unknown) {
      setChannelsError(
        `${t('friend_keys.channels_load_failed')}: ${getErrorMessage(err, t('friend_keys.channels_load_failed'))}`
      );
    } finally {
      setChannelsLoading(false);
    }
  }, [connected, t]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadFriends(), channels || channelsError ? loadChannels() : null]);
  }, [channels, channelsError, loadChannels, loadFriends]);

  useHeaderRefresh(refreshAll, connected);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  const openForm = (action: { type: 'open_create' } | { type: 'open_edit'; friend: FriendKey }) => {
    dispatchDialog(action);
    if (!channels && !channelsLoading) void loadChannels();
  };

  const today = toDateInputValue(now);
  const existingNames = useMemo(() => (friends ?? []).map((friend) => friend.name), [friends]);
  const formInitial: FriendFormValues | null =
    dialog.kind === 'create'
      ? EMPTY_FRIEND_FORM
      : dialog.kind === 'edit'
        ? friendToFormValues(dialog.friend, channels ?? [])
        : null;

  const handleSubmit = async (values: FriendFormValues): Promise<FriendFormSubmitResult | void> => {
    try {
      if (dialog.kind === 'create') {
        const result = await z10FriendsApi.create(buildCreateInput(values));
        setFriends((current) => upsertFriend(current ?? [], result.friend));
        dispatchDialog({ type: 'created', friend: result.friend, key: result.key });
        return;
      }
      if (dialog.kind === 'edit' && formInitial) {
        const patch = buildUpdateInput(formInitial, values);
        if (Object.keys(patch).length > 0) {
          const friend = await z10FriendsApi.update(dialog.friend.name, patch);
          setFriends((current) => upsertFriend(current ?? [], friend));
          showNotification(t('friend_keys.update_success', { name: friend.name }), 'success');
        }
        dispatchDialog({ type: 'close' });
      }
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      if (status === 409 && dialog.kind === 'create') {
        return { fieldErrors: { name: 'friend_keys.error_name_taken' } };
      }
      if (status === 404 && dialog.kind === 'edit') void loadFriends();
      return { error: friendErrorMessage(err, t, 'friend_keys.save_failed') };
    }
  };

  const handleToggle = async (friend: FriendKey, enabled: boolean) => {
    if (togglingName) return;
    setTogglingName(friend.name);
    try {
      const updated = await z10FriendsApi.update(friend.name, { enabled });
      setFriends((current) => upsertFriend(current ?? [], updated));
      showNotification(
        t(enabled ? 'friend_keys.enable_success' : 'friend_keys.disable_success', {
          name: friend.name,
        }),
        'success'
      );
    } catch (err: unknown) {
      showNotification(
        `${t('friend_keys.toggle_failed')}: ${friendErrorMessage(err, t, 'friend_keys.toggle_failed')}`,
        'error'
      );
      if (getErrorStatus(err) === 404) void loadFriends();
    } finally {
      setTogglingName('');
    }
  };

  const handleDelete = (friend: FriendKey) =>
    requestFriendDelete(friend, {
      t,
      showConfirmation,
      remove: z10FriendsApi.remove,
      notify: showNotification,
      reload: loadFriends,
    });

  const formatExpiry = (friend: FriendKey) =>
    friend.expires
      ? t('friend_keys.expires_on', { date: friend.expires })
      : t('friend_keys.expires_never');

  const renderLastUsed = (friend: FriendKey) => {
    const ms = friend.lastUsed ? Date.parse(friend.lastUsed) : NaN;
    if (!Number.isFinite(ms)) return t('friend_keys.never_used');
    return (
      <>
        {t('friend_keys.last_used')}{' '}
        <strong title={new Date(ms).toLocaleString(i18n.resolvedLanguage)}>
          {formatRelativeInstant(ms, now, i18n.resolvedLanguage)}
        </strong>
      </>
    );
  };

  const list = friends ?? [];
  const showSkeleton = loading && friends === null;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>{t('friend_keys.title')}</h1>
        <p className={styles.description}>{t('friend_keys.description')}</p>
      </div>

      {error ? <div className={styles.errorBox}>{error}</div> : null}

      {friends !== null && list.length > 0 ? (
        <div className={styles.toolbar}>
          <Button size="sm" onClick={() => openForm({ type: 'open_create' })} disabled={!connected}>
            <IconPlus size={16} />
            {t('friend_keys.create')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refreshAll()}
            disabled={!connected || loading}
            loading={loading}
          >
            <IconRefreshCw size={16} />
            {t('common.refresh')}
          </Button>
        </div>
      ) : null}

      {showSkeleton ? (
        <div className={styles.list}>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className={styles.skeletonRow}>
              <div className={styles.skeletonLine} />
              <div className={styles.skeletonLine} />
            </div>
          ))}
        </div>
      ) : friends === null ? null : list.length === 0 ? (
        <div className={styles.emptyState}>
          <EmptyState
            title={t('friend_keys.empty_title')}
            description={t('friend_keys.empty_desc')}
            action={
              <Button
                size="sm"
                onClick={() => openForm({ type: 'open_create' })}
                disabled={!connected}
              >
                <IconPlus size={16} />
                {t('friend_keys.create')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className={styles.list}>
          {list.map((friend) => {
            const status = FRIEND_STATUS_META[getFriendStatus(friend)];
            return (
              <article key={friend.name} className={styles.row}>
                <div className={styles.info}>
                  <div className={styles.nameRow}>
                    <h2>{friend.name}</h2>
                    <span className={BADGE_CLASS[status.tone]}>{t(status.labelKey)}</span>
                  </div>
                  <div className={styles.chipRow}>
                    {friend.channels.map((channel) => (
                      <span key={channel} className={styles.chip}>
                        {channel}
                      </span>
                    ))}
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.metaItem}>{formatExpiry(friend)}</span>
                    <span className={styles.metaDot} aria-hidden="true" />
                    <span className={styles.metaItem}>{renderLastUsed(friend)}</span>
                    <span className={styles.metaDot} aria-hidden="true" />
                    <span className={styles.metaItem}>
                      {t('friend_keys.requests', { count: friend.requests })}
                    </span>
                    <span className={styles.metaDot} aria-hidden="true" />
                    <span className={styles.metaItem} title={String(friend.totalTokens)}>
                      {t('friend_keys.tokens', { value: formatCompactNumber(friend.totalTokens) })}
                    </span>
                  </div>
                </div>

                <div className={styles.rowActions}>
                  <ToggleSwitch
                    checked={friend.enabled}
                    onChange={(enabled) => void handleToggle(friend, enabled)}
                    disabled={!connected || Boolean(togglingName)}
                    ariaLabel={t('friend_keys.enabled_label', { name: friend.name })}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openForm({ type: 'open_edit', friend })}
                    disabled={!connected}
                  >
                    <IconPencil size={14} />
                    {t('friend_keys.edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(friend)}
                    disabled={!connected}
                    aria-label={t('friend_keys.delete_label', { name: friend.name })}
                  >
                    <IconTrash2 size={14} />
                    {t('common.delete')}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {formInitial && (dialog.kind === 'create' || dialog.kind === 'edit') ? (
        <FriendFormModal
          key={dialog.kind === 'edit' ? `edit:${dialog.friend.name}` : 'create'}
          mode={dialog.kind}
          initial={formInitial}
          channels={channels}
          channelsLoading={channelsLoading}
          channelsError={channelsError}
          existingNames={existingNames}
          today={today}
          onRetryChannels={() => void loadChannels()}
          onSubmit={handleSubmit}
          onClose={() => dispatchDialog({ type: 'close' })}
        />
      ) : null}

      {dialog.kind === 'created' ? (
        <FriendKeyResultModal
          name={dialog.friend.name}
          secret={dialog.key}
          onClose={() => dispatchDialog({ type: 'close' })}
        />
      ) : null}
    </div>
  );
}
