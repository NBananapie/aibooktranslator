"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/components/Toast';
import { isStrongSyncKey, generateStrongSyncKey } from '@/lib/crypto';
import {
  fetchCloudBookshelf,
  testCloudSyncConnection,
  deleteBookFromCloud,
  CloudBookMeta,
} from '@/services/cloudSyncService';
import styles from '@/app/page.module.css';
import {
  ArrowLeft,
  Cloud,
  Key,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  ShieldCheck,
  Lock,
  Sun,
  Moon,
  FileText,
  AlertTriangle,
  Info,
} from 'lucide-react';

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return '未知时间';
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export default function CloudSyncPage() {
  const router = useRouter();
  const { settings, setSettings, theme, toggleTheme } = useAppContext();
  const { showToast } = useToast();

  const [syncKey, setSyncKey] = useState<string>(settings.syncKey || '');
  const [autoCloudSync, setAutoCloudSync] = useState<boolean>(settings.autoCloudSync !== false);
  const [copied, setCopied] = useState<boolean>(false);
  const [confirmClearKey, setConfirmClearKey] = useState<boolean>(false);
  const [confirmDeleteFingerprint, setConfirmDeleteFingerprint] = useState<string | null>(null);

  const [testStatus, setTestStatus] = useState<{
    testing: boolean;
    message?: string;
    success?: boolean;
  }>({ testing: false });

  const [cloudBooks, setCloudBooks] = useState<CloudBookMeta[]>([]);
  const [loadingBooks, setLoadingBooks] = useState<boolean>(() =>
    isStrongSyncKey(settings.syncKey)
  );
  const [deletingHash, setDeletingHash] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.syncKey?.trim() || !isStrongSyncKey(settings.syncKey)) return;
    fetchCloudBookshelf(settings.syncKey)
      .then(books => setCloudBooks(books || []))
      .catch(err => console.error('Failed to load cloud bookshelf:', err))
      .finally(() => setLoadingBooks(false));
  }, [settings.syncKey]);

  const handleCopyKey = () => {
    if (!syncKey) return;
    navigator.clipboard.writeText(syncKey).then(() => {
      setCopied(true);
      showToast('同步口令已复制到剪贴板', 'success');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleGenerateKey = () => {
    const newKey = generateStrongSyncKey();
    setSyncKey(newKey);
    setConfirmClearKey(false);
    setTestStatus({ testing: false });
  };

  const loadCloudBooks = (keyToUse: string) => {
    if (!isStrongSyncKey(keyToUse)) return;
    setLoadingBooks(true);
    fetchCloudBookshelf(keyToUse)
      .then(b => setCloudBooks(b || []))
      .catch(err => console.error('Failed to load cloud bookshelf:', err))
      .finally(() => setLoadingBooks(false));
  };

  const handleTestConnection = async () => {
    if (!syncKey.trim()) {
      setTestStatus({ testing: false, success: false, message: '请先输入或生成同步口令' });
      return;
    }
    if (!isStrongSyncKey(syncKey)) {
      setTestStatus({
        testing: false,
        success: false,
        message: '口令过短：需至少 16 位高熵字符以防爆破并启用 AES-GCM 端到端加密',
      });
      return;
    }

    setTestStatus({ testing: true, message: '正在安全验证 Cloudflare D1 连接与凭证...' });
    const res = await testCloudSyncConnection(syncKey);
    if (res.success) {
      setTestStatus({
        testing: false,
        success: true,
        message: `连接成功，云端已有此口令下的 ${res.count} 本书籍同步记录。`,
      });
      loadCloudBooks(syncKey);
    } else {
      setTestStatus({
        testing: false,
        success: false,
        message: `连接失败: ${res.error}`,
      });
    }
  };

  const handleSaveSettings = () => {
    if (syncKey.trim() && !isStrongSyncKey(syncKey)) {
      setTestStatus({
        testing: false,
        success: false,
        message: '保存未通过：口令长度不足 16 位字符，请使用更长口令或点击「生成高熵口令」',
      });
      return;
    }

    setSettings({
      ...settings,
      syncKey: syncKey.trim(),
      autoCloudSync,
    });

    showToast('云端同步设置已保存', 'success');

    if (syncKey.trim()) {
      loadCloudBooks(syncKey.trim());
    }
  };

  const executeClearKey = () => {
    setSyncKey('');
    setSettings({
      ...settings,
      syncKey: '',
    });
    setCloudBooks([]);
    setConfirmClearKey(false);
    setTestStatus({ testing: false });
    showToast('已清除本机同步口令（云端加密数据仍保留）');
  };

  const executeDeleteBook = async (fingerprint: string) => {
    setDeletingHash(fingerprint);
    const ok = await deleteBookFromCloud(syncKey, fingerprint);
    setDeletingHash(null);
    setConfirmDeleteFingerprint(null);
    if (ok) {
      setCloudBooks(prev => prev.filter(b => b.bookFingerprint !== fingerprint));
      showToast('已从云端移除该书同步记录', 'success');
    } else {
      showToast('从云端删除失败，请检查网络或口令有效性', 'error');
    }
  };

  const isKeyValid = isStrongSyncKey(syncKey);

  return (
    <div className={styles.homeContainer}>
      <header className={styles.homeHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            className={styles.backShelfBtn}
            onClick={() => router.push('/')}
          >
            <ArrowLeft size={14} />
            <span>返回书架</span>
          </button>
          <span className={styles.headerDivider} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <Cloud size={16} style={{ color: 'var(--primary)' }} />
            <h1 style={{ fontSize: '15px', margin: 0, fontWeight: 600 }}>多端云同步与加密书架</h1>
          </div>
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.headerIconSquareBtn}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '切换为暖白纸感模式' : '切换为深色夜间模式'}
            title={theme === 'dark' ? '切换为暖白纸感模式' : '切换为深色夜间模式'}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <main className={styles.syncPageContainer}>
        {/* 卡片 1: 同步口令管理 */}
        <div className={styles.syncCard}>
          <div className={styles.syncCardHeader}>
            <h2 className={styles.syncCardTitle}>
              <Key size={16} style={{ color: 'var(--primary)' }} />
              <span>端到端加密同步口令</span>
            </h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={styles.btnSmSecondary}
                onClick={handleGenerateKey}
              >
                <Key size={13} />
                <span>生成高熵口令</span>
              </button>

              {settings.syncKey && (
                confirmClearKey ? (
                  <>
                    <button
                      type="button"
                      className={styles.btnSmDanger}
                      onClick={executeClearKey}
                    >
                      确认清除本机口令
                    </button>
                    <button
                      type="button"
                      className={styles.btnSmSecondary}
                      onClick={() => setConfirmClearKey(false)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.btnSmDangerOutline}
                    onClick={() => setConfirmClearKey(true)}
                  >
                    清除本机口令
                  </button>
                )
              )}
            </div>
          </div>

          <p className={styles.settingsHint} style={{ margin: 0 }}>
            同步口令是跨设备共享译文、阅读进度与书摘的唯一派生密钥。在不同设备填入相同口令即可自动对齐，服务器不保存明文。
          </p>

          <div className={styles.syncKeyDisplayBox}>
            <input
              type="text"
              value={syncKey}
              onChange={e => setSyncKey(e.target.value)}
              placeholder="输入或生成安全同步口令（至少 16 位字符）"
              className={styles.syncKeyInput}
            />
            {syncKey && (
              <button
                type="button"
                className={styles.iconFieldBtn}
                onClick={handleCopyKey}
                title="复制口令"
              >
                {copied ? <Check size={15} style={{ color: 'var(--accent-emerald)' }} /> : <Copy size={15} />}
              </button>
            )}
          </div>

          <div className={styles.syncBadgeRow}>
            {syncKey.trim().length === 0 ? (
              <span className={styles.syncSecurityBadge}>
                <Info size={12} />
                <span>尚未配置同步口令</span>
              </span>
            ) : !isKeyValid ? (
              <span
                className={styles.syncSecurityBadge}
                style={{ color: 'var(--accent-rose)', borderColor: 'rgba(181, 51, 51, 0.25)' }}
              >
                <AlertTriangle size={12} />
                <span>当前 {syncKey.trim().length} 位，需至少 16 位字符</span>
              </span>
            ) : (
              <>
                <span
                  className={styles.syncSecurityBadge}
                  style={{ color: 'var(--accent-emerald)', borderColor: 'rgba(47, 111, 78, 0.25)' }}
                >
                  <ShieldCheck size={12} />
                  <span>16+ 位高熵凭据已就绪</span>
                </span>
                <span className={styles.syncSecurityBadge}>
                  <Lock size={12} />
                  <span>客户端 AES-GCM 256 位加密已启用</span>
                </span>
              </>
            )}
          </div>

          {testStatus.message && (
            <p className={testStatus.success ? styles.statusInlineSuccess : styles.statusInlineError}>
              {testStatus.message}
            </p>
          )}

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={autoCloudSync}
              onChange={e => setAutoCloudSync(e.target.checked)}
            />
            <span>阅读翻页、翻译或划线书摘时静默增量同步至云端</span>
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={handleTestConnection}
              disabled={testStatus.testing || !syncKey.trim()}
            >
              <RefreshCw size={13} className={testStatus.testing ? styles.spinAnim : ''} />
              <span>{testStatus.testing ? '检测中...' : '测试连接'}</span>
            </button>
            <button type="button" className={styles.btn} onClick={handleSaveSettings}>
              <span>保存口令与设置</span>
            </button>
          </div>
        </div>

        {/* 卡片 2: 云端书架数据 */}
        <div className={styles.syncCard}>
          <div className={styles.syncCardHeader}>
            <h2 className={styles.syncCardTitle}>
              <Cloud size={16} style={{ color: 'var(--primary)' }} />
              <span>云端已同步书籍 ({cloudBooks.length})</span>
            </h2>
            {isKeyValid && (
              <button
                type="button"
                className={styles.headerIconBtn}
                onClick={() => loadCloudBooks(syncKey)}
                title="刷新云端书架"
                disabled={loadingBooks}
              >
                <RefreshCw size={14} className={loadingBooks ? styles.spinAnim : ''} />
              </button>
            )}
          </div>

          {!isKeyValid ? (
            <div className={styles.emptyText}>请先输入并保存合法同步口令以查看云端同步记录。</div>
          ) : loadingBooks ? (
            <div className={styles.emptyText}>正在读取云端书架记录...</div>
          ) : cloudBooks.length === 0 ? (
            <div className={styles.emptyText}>
              当前口令下尚无云端记录。在任意设备打开 PDF 阅读并开启自动同步即可在此查看。
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.syncBookTable}>
                <thead>
                  <tr>
                    <th>书籍名称</th>
                    <th>页数</th>
                    <th>阅读进度</th>
                    <th>最近同步</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {cloudBooks.map(book => (
                    <tr key={book.bookFingerprint} className={styles.syncBookRow}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <FileText size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                          <span style={{ fontWeight: 500 }} title={book.filename}>
                            {book.filename}
                          </span>
                        </div>
                      </td>
                      <td>{book.totalPages > 0 ? `${book.totalPages} 页` : '–'}</td>
                      <td>
                        <span className={styles.badgeSubtle}>第 {book.lastReadPage || 1} 页</span>
                      </td>
                      <td>
                        {formatTimestamp(book.updatedAt)}
                        {book.legacy ? '（旧版只读）' : ''}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {confirmDeleteFingerprint === book.bookFingerprint ? (
                          <div
                            className={styles.inlineConfirmGroup}
                            style={{ justifyContent: 'flex-end' }}
                          >
                            <button
                              type="button"
                              className={styles.inlineConfirmDanger}
                              disabled={deletingHash === book.bookFingerprint}
                              onClick={() => executeDeleteBook(book.bookFingerprint)}
                            >
                              {deletingHash === book.bookFingerprint ? '移除中...' : '确认删除'}
                            </button>
                            <button
                              type="button"
                              className={styles.inlineConfirmCancel}
                              onClick={() => setConfirmDeleteFingerprint(null)}
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={styles.deleteBtn}
                            onClick={() => setConfirmDeleteFingerprint(book.bookFingerprint)}
                            disabled={book.legacy || deletingHash === book.bookFingerprint}
                            title={book.legacy ? '旧版数据打开后自动迁移' : '从云端删除此书同步记录'}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 卡片 3: 安全与隐私架构说明 */}
        <div className={styles.syncCard}>
          <h2 className={styles.syncCardTitle}>
            <ShieldCheck size={16} style={{ color: 'var(--accent-emerald)' }} />
            <span>隐私与端到端加密说明</span>
          </h2>
          <div className={styles.securityGrid}>
            <div className={styles.securityFeatureCard}>
              <h4>1. 零原文件上传</h4>
              <p>
                云端不接收也不存储任何 PDF 原件。多端通过本地 PDF 的 SHA-256 内容指纹自动识别匹配，原书始终留在本地设备。
              </p>
            </div>
            <div className={styles.securityFeatureCard}>
              <h4>2. 本地 AES-GCM 加密</h4>
              <p>
                译文、书摘与书名在离开浏览器前即用口令派生密钥完成 256 位加密。服务器仅保存派生认证哈希，无法逆向解密任何内容。
              </p>
            </div>
            <div className={styles.securityFeatureCard}>
              <h4>3. 按页增量合并</h4>
              <p>
                无需注册账号。每页译文与每条书摘按时间戳独立合并，多设备交替阅读也不会互相覆盖。请妥善保管口令。
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
