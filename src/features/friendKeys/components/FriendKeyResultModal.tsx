import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { IconAlertTriangle, IconCheck, IconCopy } from '@/components/ui/icons';
import { copyToClipboard } from '@/utils/clipboard';
import styles from '../FriendKeysPage.module.scss';

interface FriendKeyResultContentProps {
  name: string;
  secret: string;
  copied: boolean;
  copyFailed: boolean;
  onCopy: () => void;
}

export function FriendKeyResultContent({
  name,
  secret,
  copied,
  copyFailed,
  onCopy,
}: FriendKeyResultContentProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.resultBody}>
      <div className={styles.warningBox} role="alert">
        <IconAlertTriangle size={16} />
        <span>{t('friend_keys.key_warning')}</span>
      </div>
      <div className={styles.keyField}>
        <span className={styles.keyFieldLabel}>{t('friend_keys.key_label', { name })}</span>
        <div className={styles.keyRow}>
          <code className={styles.keyValue}>{secret}</code>
          <Button variant="secondary" size="sm" onClick={onCopy}>
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied ? t('friend_keys.copied') : t('common.copy')}
          </Button>
        </div>
        {copyFailed ? (
          <div className={styles.fieldError}>{t('friend_keys.copy_failed')}</div>
        ) : null}
      </div>
    </div>
  );
}

interface FriendKeyResultModalProps {
  name: string;
  secret: string;
  onClose: () => void;
}

/** Mounted only while the key exists; the parent drops the key when this closes. */
export function FriendKeyResultModal({ name, secret, onClose }: FriendKeyResultModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(secret);
    setCopied(ok);
    setCopyFailed(!ok);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('friend_keys.key_title')}
      footer={<Button onClick={onClose}>{t('friend_keys.key_done')}</Button>}
    >
      <FriendKeyResultContent
        name={name}
        secret={secret}
        copied={copied}
        copyFailed={copyFailed}
        onCopy={() => void handleCopy()}
      />
    </Modal>
  );
}
