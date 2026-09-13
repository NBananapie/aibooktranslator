"use client";

import React from 'react';
import styles from '@/app/page.module.css';

export interface ProgressRingProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  showText?: boolean;
  tooltip?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function ProgressRing({
  percent,
  size = 48,
  strokeWidth = 4,
  showText = true,
  tooltip,
  className,
  style,
}: ProgressRingProps) {
  const radius = Math.max(1, (size - strokeWidth * 2) / 2);
  const circumference = radius * 2 * Math.PI;
  const validPercent = Math.min(100, Math.max(0, Math.round(percent || 0)));
  const offset = circumference - (validPercent / 100) * circumference;

  return (
    <div
      className={`${styles.progressRingWrapper} ${className || ''}`}
      style={{ width: size, height: size, ...style }}
      data-tooltip={tooltip || `阅读进度: ${validPercent}%`}
    >
      <svg className={styles.progressRingSvg} width={size} height={size}>
        <circle
          className={styles.progressRingBg}
          strokeWidth={strokeWidth}
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className={styles.progressRingFill}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset: offset }}
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
      </svg>
      {showText && <span className={styles.progressRingText}>{validPercent}%</span>}
    </div>
  );
}
