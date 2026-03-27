'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import styles from './AppShell.module.css';

const navItems = [
  { href: '/', icon: 'search', label: '검색' },
  { href: '/analyze', icon: 'auto_awesome', label: 'AI 분석' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const saved = localStorage.getItem('theme') as 'light' | 'dark';
    if (saved === 'dark' || saved === 'light') {
      setTheme(saved);
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const handleSettingsClick = () => {
    window.dispatchEvent(new CustomEvent('open-settings'));
  };

  return (
    <div className={styles.appShell}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <span className="material-symbols-outlined">online_prediction</span>
          </div>
          <div className={styles.brandText}>
            <h1 className={styles.brandTitle}>뉴스봇</h1>
            <p className={styles.brandSubtitle}>나의 뉴스 비서</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className={styles.navSection}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${pathname === item.href ? styles.active : ''}`}
            >
              <span className={`material-symbols-outlined ${styles.navIcon}`}>{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* Bottom buttons */}
        <div className={styles.sidebarBottom}>
          {pathname === '/' && (
            <button
              className={styles.navButton}
              onClick={handleSettingsClick}
              title="자동 검색 설정"
            >
              <span className={`material-symbols-outlined ${styles.navIcon}`}>settings</span>
              <span className={styles.navLabel}>설정</span>
            </button>
          )}
          <button
            className={styles.navButton}
            onClick={toggleTheme}
            title={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'}
          >
            <span className={`material-symbols-outlined ${styles.navIcon}`}>
              {theme === 'light' ? 'dark_mode' : 'light_mode'}
            </span>
            <span className={styles.navLabel}>{theme === 'light' ? '다크 모드' : '라이트 모드'}</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className={styles.mainContent}>
        {children}
      </main>
    </div>
  );
}
