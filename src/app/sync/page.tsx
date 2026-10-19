"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/context/AppContext';
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
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function CloudSyncPage() {
  const router = useRouter();
  const { settings, setSettings, theme, toggleTheme } = useAppContext();

  const [syncKey, setSyncKey] = useState<string>(settings.syncKey || '');
  const [autoCloudSync, setAutoCloudSync] = useState<boolean>(settings.autoCloudSync !== false);
  const [copied, setCopied] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [testStatus, setTestStatus] = useState<{ testing: boolean; message?: string; success?: boolean }>({
    testing: false,
  });

  const [cloudBooks, setCloudBooks] = useState<CloudBookMeta[]>([]);
  const [loadingBooks, setLoadingBooks] = useState<boolean>(false);
  const [deletingHash, setDeletingHash] = useState<string | null>(null);

  // 初始化加载云端书架
  useEffect(() => {
    if (settings.syncKey?.trim() && isStrongSyncKey(settings.syncKey)) {
      setLoadingBooks(true);
      fetchCloudBookshelf(settings.syncKey)
        .then(books => setCloudBooks(books || []))
        .catch(err => console.error('Failed to load cloud bookshelf:', err))
        .finally(() => setLoadingBooks(false));
    }
  }, [settings.syncKey]);

  // 一键复制口令
  const handleCopyKey = () => {
    if (!syncKey) return;
    navigator.clipboard.writeText(syncKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // 生成强随机高熵口令
  const handleGenerateKey = () => {
    const newKey = generateStrongSyncKey();
    setSyncKey(newKey);
    setTestStatus({ testing: false });
  };

  // 测试云端连接
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
        message: `连接成功！云端已有此口令下的 ${res.count} 本书籍同步记录。`,
      });
      // 顺便刷新云端书架
      loadCloudBooks(syncKey);
    } else {
      setTestStatus({
        testing: false,
        success: false,
        message: `连接失败: ${res.error}`,
      });
    }
  };

  // 刷新云端书籍列表
  const loadCloudBooks = (keyToUse: string) => {
    if (!isStrongSyncKey(keyToUse)) return;
    setLoadingBooks(true);
    fetchCloudBookshelf(keyToUse)
      .then(b => setCloudBooks(b || []))
      .finally(() => setLoadingBooks(false));
  };

  // 保存设置
  const handleSaveSettings = () => {
    if (syncKey.trim() && !isStrongSyncKey(syncKey)) {
      setTestStatus({
        testing: false,
        success: false,
        message: '保存失败：口令长度不足 16 位字符，请使用更长的口令或点击“生成高熵口令”',
      });
      return;
    }

    setSettings({
      ...settings,
      syncKey: syncKey.trim(),
      autoCloudSync,
    });

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);

    if (syncKey.trim()) {
      loadCloudBooks(syncKey.trim());
    }
  };

  // 清除口令
  const handleClearKey = () => {
    if (confirm('确定要清除本机的同步口令吗？（云端已存储的数据不会被删除，可在重新输入口令后恢复）')) {
      setSyncKey('');
      setSettings({
        ...settings,
        syncKey: '',
      });
      setCloudBooks([]);
      setTestStatus({ testing: false });
    }
  };

  // 删除单本云端书籍记录
  const handleDeleteBook = async (fingerprint: string, filename: string) => {
    if (!confirm(`确定要从云端删除《${filename}》的所有同步翻译与剪藏吗？`)) return;
    setDeletingHash(fingerprint);
    const ok = await deleteBookFromCloud(syncKey, fingerprint);
    setDeletingHash(null);
    if (ok) {
      setCloudBooks(prev => prev.filter(b => b.book_fingerprint !== fingerprint));
    } else {
      alert('从云端删除失败，请检查网络或口令有效性');
    }
  };

  const isKeyValid = isStrongSyncKey(syncKey);

  return (
    <div className={styles.homeContainer}>
      {/* 顶部导航栏 */}
      <header className={styles.homeHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={() => router.push('/')}
            data-tooltip="返回书架主页"
          >
            <ArrowLeft size={15} />
            <span>返回主页</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Cloud size={18} style={{ color: 'var(--primary)' }} />
            <h1 style={{ fontSize: '18px', margin: 0, fontWeight: 600 }}>云端多端同步中心</h1>
          </div>
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={toggleTheme}
            data-tooltip="切换深色/浅色模式"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
          </button>
        </div>
      </header>

      {/* 主体内容 */}
      <main className={styles.syncPageContainer}>
        {/* 卡片 1: 同步口令管理 */}
        <div className={styles.syncCard}>
          <div className={styles.syncCardHeader}>
            <h2 className={styles.syncCardTitle}>
              <Key size={17} style={{ color: 'var(--primary)' }} /> 同步口令与加密凭据 (Sync Key)
            </h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className={styles.headerBtn}
                style={{ height: '32px', fontSize: '12px' }}
                onClick={handleGenerateKey}
                data-tooltip="生成 37 位不可穷举的高熵安全口令"
              >
                <Key size={13} /> 生成高熵口令
              </button>
              {settings.syncKey && (
                <button
                  type="button"
                  className={styles.headerBtn}
                  style={{ height: '32px', fontSize: '12px', color: 'var(--accent-rose)' }}
                  onClick={handleClearKey}
                >
                  清除口令
                </button>
              )}
            </div>
          </div>

          <p style={{ fontSize: '13px', color: '#8e8e93', margin: 0, lineHeight: 1.6 }}>
            同步口令是您跨设备共享书籍翻译与重点摘录的唯一密钥。在所有需要同步的设备上输入同一口令即可自动对齐。
          </p>

          <div className={styles.syncKeyDisplayBox}>
            <input
              type="text"
              value={syncKey}
              onChange={e => setSyncKey(e.target.value)}
              placeholder="输入或生成您的安全同步口令 (至少 16 位字符)"
              className={styles.syncKeyInput}
            />
            {syncKey && (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={handleCopyKey}
                data-tooltip={copied ? '已复制到剪贴板' : '一键复制口令'}
              >
                {copied ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} />}
              </button>
            )}
          </div>

          {/* 实时口令安全强度提示 */}
          <div className={styles.syncBadgeRow}>
            {syncKey.trim().length === 0 ? (
              <span className={styles.syncSecurityBadge} style={{ background: 'rgba(255,255,255,0.05)', color: '#8e8e93' }}>
                <Info size={12} /> 尚未配置同步口令
              </span>
            ) : !isKeyValid ? (
              <span className={styles.syncSecurityBadge} style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-rose)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <AlertTriangle size={12} /> 口令过短（当前 {syncKey.trim().length} 位，需至少 16 位字符以防暴力破解）
              </span>
            ) : (
              <>
                <span className={styles.syncSecurityBadge} style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <ShieldCheck size={12} /> 16+ 位高熵凭据已就绪
                </span>
                <span className={styles.syncSecurityBadge} style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                  <Lock size={12} /> 客户端 AES-GCM 256 位端到端加密已启用
                </span>
              </>
            )}
          </div>

          {/* 测试连接反馈 */}
          {testStatus.message && (
            <div
              style={{
                fontSize: '12.5px',
                padding: '8px 12px',
                borderRadius: '8px',
                background: testStatus.success ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                color: testStatus.success ? '#10b981' : 'var(--accent-rose)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {testStatus.success ? <Check size={14} /> : <AlertTriangle size={14} />}
              {testStatus.message}
            </div>
          )}

          {/* 自动同步开关 */}
          <div style={{ marginTop: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={autoCloudSync}
                onChange={e => setAutoCloudSync(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--primary)' }}
              />
              <span>阅读翻页或划线笔记时自动静默增量同步至云端</span>
            </label>
          </div>

          {/* 底部保存与测试按钮 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <button
              type="button"
              className={styles.headerBtn}
              onClick={handleTestConnection}
              disabled={testStatus.testing || !syncKey.trim()}
            >
              <RefreshCw size={13} className={testStatus.testing ? styles.spinAnim : ''} />
              <span>{testStatus.testing ? '检测中...' : '测试云端连接'}</span>
            </button>
            <button
              type="button"
              className={`${styles.headerBtn} ${styles.headerBtnPrimary}`}
              onClick={handleSaveSettings}
            >
              {saveSuccess ? <Check size={14} /> : null}
              <span>{saveSuccess ? '已成功保存' : '保存口令与设置'}</span>
            </button>
          </div>
        </div>

        {/* 卡片 2: 云端书架数据 */}
        <div className={styles.syncCard}>
          <div className={styles.syncCardHeader}>
            <h2 className={styles.syncCardTitle}>
              <Cloud size={17} style={{ color: 'var(--primary)' }} /> 云端已同步文档库 ({cloudBooks.length})
            </h2>
            {isKeyValid && (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => loadCloudBooks(syncKey)}
                data-tooltip="刷新云端书架"
                disabled={loadingBooks}
              >
                <RefreshCw size={13} className={loadingBooks ? styles.spinAnim : ''} />
              </button>
            )}
          </div>

          {!isKeyValid ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#8e8e93', fontSize: '13px' }}>
              请先在上方输入并保存合法的同步口令以查看此口令下的云端书籍。
            </div>
          ) : loadingBooks ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#8e8e93', fontSize: '13px' }}>
              正在加载云端书架数据...
            </div>
          ) : cloudBooks.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#8e8e93', fontSize: '13px' }}>
              当前口令下暂无云端书籍。在任何设备打开 PDF 文档并开启自动同步，即可在此查看多端同步记录。
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.syncBookTable}>
                <thead>
                  <tr>
                    <th>书籍名称</th>
                    <th>总页数</th>
                    <th>续读进度</th>
                    <th>最后更新时间</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {cloudBooks.map(book => (
                    <tr key={book.book_fingerprint} className={styles.syncBookRow}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <FileText size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                          <span style={{ fontWeight: 500 }} title={book.filename}>
                            {book.filename}
                          </span>
                        </div>
                      </td>
                      <td>{book.total_pages > 0 ? `${book.total_pages} 页` : '-'}</td>
                      <td>
                        <span className={styles.badgeSubtle}>
                          第 {book.last_read_page || 1} 页
                        </span>
                      </td>
                      <td>{formatTimestamp(book.updated_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={() => handleDeleteBook(book.book_fingerprint, book.filename)}
                          disabled={deletingHash === book.book_fingerprint}
                          data-tooltip="从云端彻底删除此书籍的同步记录"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 卡片 3: 安全与隐私机制说明 */}
        <div className={styles.syncCard}>
          <h2 className={styles.syncCardTitle} style={{ fontSize: '15px' }}>
            <ShieldCheck size={16} style={{ color: '#10b981' }} /> 多端同步安全与隐私保护架构
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginTop: '6px' }}>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '10px', padding: '14px' }}>
              <h4 style={{ margin: '0 0 6px 0', fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
                1. 零原文件上传
              </h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#8e8e93', lineHeight: 1.5 }}>
                云端数据库完全不接收也不保存任何 PDF 原文文件。多端之间基于本地文件的 SHA-256 二进制指纹秒级匹配，原文件始终完全留在您的设备本地。
              </p>
            </div>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '10px', padding: '14px' }}>
              <h4 style={{ margin: '0 0 6px 0', fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
                2. 客户端端到端加密 (E2EE)
              </h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#8e8e93', lineHeight: 1.5 }}>
                翻译文本与摘录在离开浏览器前，均使用您的口令派生出的 AES-GCM 256 位密钥在本地加密。云端 D1 仅存储不可读密文，即便数据泄露也无法还原文字。
              </p>
            </div>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '10px', padding: '14px' }}>
              <h4 style={{ margin: '0 0 6px 0', fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
                3. 免注册与高熵防御
              </h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#8e8e93', lineHeight: 1.5 }}>
                无需提供手机号或邮箱，通过 16+ 位高熵随机构造出 $2^{122}$ 级抗爆破能力，杜绝黑客字典枚举，同时在接口层严格限制 5MB 请求体以防范恶意攻击。
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
