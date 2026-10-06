import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconChevronDown, IconChevronUp } from '@/components/ui/icons';
import type { Z10Channel } from '@/services/api/z10Friends';
import {
  buildChannelOptions,
  validateFriendForm,
  type FriendFormErrors,
  type FriendFormValues,
} from '../logic';
import styles from '../FriendKeysPage.module.scss';

export interface FriendFormSubmitResult {
  /** i18n key for a field error (e.g. the name is taken). */
  fieldErrors?: FriendFormErrors;
  /** Server message shown above the form actions. */
  error?: string;
}

interface FriendFormModalProps {
  mode: 'create' | 'edit';
  initial: FriendFormValues;
  channels: Z10Channel[] | null;
  channelsLoading: boolean;
  channelsError: string;
  existingNames: string[];
  today: string;
  onRetryChannels: () => void;
  onSubmit: (values: FriendFormValues) => Promise<FriendFormSubmitResult | void>;
  onClose: () => void;
}

export function FriendFormModal({
  mode,
  initial,
  channels,
  channelsLoading,
  channelsError,
  existingNames,
  today,
  onRetryChannels,
  onSubmit,
  onClose,
}: FriendFormModalProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<FriendFormValues>(initial);
  const [errors, setErrors] = useState<FriendFormErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const context = useMemo(
    () => ({ mode, existingNames, today, initialExpires: initial.expires }),
    [existingNames, initial.expires, mode, today]
  );
  const options = useMemo(
    () => buildChannelOptions(channels ?? [], values.channels),
    [channels, values.channels]
  );

  const update = (next: FriendFormValues) => {
    setValues(next);
    setSubmitError('');
    if (submitted) setErrors(validateFriendForm(next, context));
  };

  // Channel names match case-insensitively on the server.
  const isSelected = (name: string) =>
    values.channels.some((item) => item.toLowerCase() === name.toLowerCase());

  const toggleChannel = (name: string, checked: boolean) => {
    const rest = values.channels.filter((item) => item.toLowerCase() !== name.toLowerCase());
    update({ ...values, channels: checked ? [...rest, name] : rest });
  };

  const toggleExpanded = (name: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (saving) return;
    setSubmitted(true);
    const nextErrors = validateFriendForm(values, context);
    setErrors(nextErrors);
    setSubmitError('');
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const result = await onSubmit(values);
      if (result?.fieldErrors) setErrors(result.fieldErrors);
      if (result?.error) setSubmitError(result.error);
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode === 'create'
      ? t('friend_keys.create_title')
      : t('friend_keys.edit_title', { name: initial.name });

  const renderChannels = () => {
    if (channelsLoading && !channels) {
      return (
        <div className={styles.channelState}>
          <LoadingSpinner size={16} />
          <span>{t('common.loading')}</span>
        </div>
      );
    }
    if (channelsError && !channels) {
      return (
        <div className={styles.channelState}>
          <span className={styles.fieldErrorText}>{channelsError}</span>
          <Button variant="secondary" size="sm" onClick={onRetryChannels}>
            {t('common.refresh')}
          </Button>
        </div>
      );
    }
    if (options.length === 0) {
      return <div className={styles.channelState}>{t('friend_keys.channels_empty')}</div>;
    }
    return (
      <div className={styles.channelList}>
        {options.map((channel) => {
          const isExpanded = expanded.has(channel.name);
          const modelsId = `friend-channel-models-${channel.name}`;
          return (
            <div key={channel.name} className={styles.channelItem}>
              <div className={styles.channelRow}>
                <SelectionCheckbox
                  checked={isSelected(channel.name)}
                  onChange={(checked) => toggleChannel(channel.name, checked)}
                  disabled={saving}
                  label={
                    <span className={styles.channelLabel}>
                      <span className={styles.channelName}>{channel.name}</span>
                      <span className={styles.channelMeta}>
                        {channel.missing
                          ? t('friend_keys.channel_missing')
                          : t('friend_keys.channel_models', { count: channel.models.length })}
                      </span>
                    </span>
                  }
                />
                {channel.models.length > 0 ? (
                  <button
                    type="button"
                    className={styles.expandButton}
                    onClick={() => toggleExpanded(channel.name)}
                    aria-expanded={isExpanded}
                    aria-controls={modelsId}
                    aria-label={t(
                      isExpanded ? 'friend_keys.hide_models' : 'friend_keys.show_models',
                      { name: channel.name }
                    )}
                  >
                    {isExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  </button>
                ) : null}
              </div>
              {isExpanded ? (
                <ul id={modelsId} className={styles.modelList}>
                  {channel.models.map((model) => (
                    <li key={model}>{model}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={560}
      closeDisabled={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} loading={saving}>
            {mode === 'create' ? t('friend_keys.submit_create') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {/* The name is fixed after creation; in edit mode it is shown in the title. */}
        {mode === 'create' ? (
          <Input
            label={t('friend_keys.name_label')}
            value={values.name}
            onChange={(event) => update({ ...values, name: event.target.value })}
            placeholder={t('friend_keys.name_placeholder')}
            hint={t('friend_keys.name_hint')}
            error={errors.name ? t(errors.name) : undefined}
            disabled={saving}
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
          />
        ) : null}

        <fieldset className={styles.fieldset} aria-describedby="friend-channels-hint">
          <legend className={styles.legend}>{t('friend_keys.channels_label')}</legend>
          <div id="friend-channels-hint" className={styles.hintText}>
            {t('friend_keys.channels_hint')}
          </div>
          {renderChannels()}
          {errors.channels ? <div className={styles.fieldError}>{t(errors.channels)}</div> : null}
        </fieldset>

        <div className={styles.expiresRow}>
          <Input
            type="date"
            label={t('friend_keys.expires_label')}
            value={values.expires}
            min={today}
            onChange={(event) => update({ ...values, expires: event.target.value })}
            hint={t('friend_keys.expires_hint')}
            error={errors.expires ? t(errors.expires) : undefined}
            disabled={saving}
          />
          {values.expires ? (
            <Button
              variant="secondary"
              className={styles.clearButton}
              onClick={() => update({ ...values, expires: '' })}
              disabled={saving}
            >
              {t('friend_keys.expires_clear')}
            </Button>
          ) : null}
        </div>

        {submitError ? <div className="error-box">{submitError}</div> : null}
      </div>
    </Modal>
  );
}
