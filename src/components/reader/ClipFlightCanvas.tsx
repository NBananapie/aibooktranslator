"use client";

import React, { useEffect, useRef } from 'react';

export interface FlightPayload {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  text: string;
}

interface StardustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  color: string;
}

interface ShockwaveRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

interface InwardSparkle {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  progress: number;
  size: number;
  color: string;
}

interface GhostSnapshot {
  x: number;
  y: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
}

export interface ClipFlightCanvasProps {
  flightPayload: FlightPayload | null;
  onFlightComplete: () => void;
}

// 优雅的非线性缓动曲线 (先轻盈跃起，再高速滑翔吸入)
function easeOutQuart(x: number): number {
  return 1 - Math.pow(1 - x, 4);
}

export function ClipFlightCanvas({ flightPayload, onFlightComplete }: ClipFlightCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!flightPayload) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animId: number;
    const startTime = performance.now();
    const duration = 520; // 520ms 紧凑干脆，极度顺滑

    const { startX, startY, targetX, targetY, text } = flightPayload;

    // 自适应屏幕像素比 (Retina 4K 高清抗锯齿)
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resizeCanvas();

    // 贝塞尔弧线控制点：向上弧形喷射 (Fountain Arc)
    const dx = targetX - startX;
    const dy = targetY - startY;
    const arcHeight = Math.max(75, Math.abs(dy) * 0.45);
    const p0 = { x: startX, y: startY };
    const p1 = {
      x: startX + dx * 0.24,
      y: Math.min(startY, targetY) - arcHeight,
    };
    const p2 = { x: targetX, y: targetY };

    // 状态粒子池与残影记录
    const particles: StardustParticle[] = [];
    const ghosts: GhostSnapshot[] = [];
    let shockwave: ShockwaveRing | null = null;
    let sparkles: InwardSparkle[] = [];
    let hasTriggeredArrival = false;

    const cardWidth = Math.min(220, Math.max(120, text.length * 13 + 36));
    const cardHeight = 32;
    const previewText = text.slice(0, 18) + (text.length > 18 ? '...' : '');

    const render = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = easeOutQuart(progress);

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // 1. 计算当前主卡片在贝塞尔曲线上的坐标
      const oneMinusE = 1 - ease;
      const curX = oneMinusE * oneMinusE * p0.x + 2 * oneMinusE * ease * p1.x + ease * ease * p2.x;
      const curY = oneMinusE * oneMinusE * p0.y + 2 * oneMinusE * ease * p1.y + ease * ease * p2.y;

      // 切线速度与旋转角度
      const tangentX = 2 * oneMinusE * (p1.x - p0.x) + 2 * ease * (p2.x - p1.x);
      const tangentY = 2 * oneMinusE * (p1.y - p0.y) + 2 * ease * (p2.y - p1.y);
      const angle = Math.atan2(tangentY, tangentX);
      const speed = Math.sqrt(tangentX * tangentX + tangentY * tangentY);

      // 非线性物理形变：高速沿飞行方向拉伸（Squash & Stretch）与接近终点时的奇点坍缩
      const stretchFactor = Math.min(0.75, speed / 850);
      const scaleShrink = Math.max(0.04, 1 - Math.pow(ease, 1.8) * 0.94);
      const curScaleX = (1 + stretchFactor) * scaleShrink;
      const curScaleY = Math.max(0.25, 1 / (1 + stretchFactor)) * scaleShrink;
      const curAlpha = progress > 0.85 ? Math.max(0, (1 - progress) / 0.15) : 1;

      // 记录残影快照 (生成真光学运动模糊拖尾)
      ghosts.unshift({
        x: curX,
        y: curY,
        angle,
        scaleX: curScaleX,
        scaleY: curScaleY,
        alpha: curAlpha,
      });
      if (ghosts.length > 4) ghosts.pop();

      // 2. 绘制光学残影 (Motion Blur Ghost Trails)
      for (let i = ghosts.length - 1; i >= 1; i--) {
        const g = ghosts[i];
        const ghostAlpha = g.alpha * (0.28 / i);
        if (ghostAlpha > 0.02) {
          drawCardCapsule(ctx, g.x, g.y, g.angle, cardWidth, cardHeight, g.scaleX, g.scaleY, ghostAlpha, '');
        }
      }

      // 3. 飞行中段生成金色星尘粒子拖尾 (Stardust Tail)
      if (progress < 0.92) {
        const tailOffset = (cardWidth / 2) * curScaleX * 0.8;
        const tailX = curX - Math.cos(angle) * tailOffset;
        const tailY = curY - Math.sin(angle) * tailOffset;

        for (let k = 0; k < 2; k++) {
          particles.push({
            x: tailX + (Math.random() - 0.5) * 10,
            y: tailY + (Math.random() - 0.5) * 10,
            vx: -Math.cos(angle) * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5,
            vy: -Math.sin(angle) * (1 + Math.random() * 2) + (Math.random() - 0.5) * 1.5,
            size: 1.5 + Math.random() * 2.5,
            alpha: 0.9,
            decay: 0.035 + Math.random() * 0.03,
            color: Math.random() > 0.35 ? '#fbbf24' : '#ffffff',
          });
        }
      }

      // 4. 更新并绘制星尘拖尾粒子
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;

        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 5. 绘制当前主飞行卡片
      if (curAlpha > 0.01) {
        drawCardCapsule(
          ctx,
          curX,
          curY,
          angle,
          cardWidth,
          cardHeight,
          curScaleX,
          curScaleY,
          curAlpha,
          previewText
        );
      }

      // 6. 到达终点瞬间：触发把手吸收共振冲击波与收缩星光
      if (progress >= 0.95 && !hasTriggeredArrival) {
        hasTriggeredArrival = true;
        shockwave = {
          x: targetX,
          y: targetY,
          radius: 3,
          maxRadius: 28,
          alpha: 0.85,
        };

        // 产生 10 颗向内坍缩的奇点光芒粒子
        for (let m = 0; m < 10; m++) {
          const sparkAngle = (Math.PI * 2 * m) / 10 + Math.random() * 0.3;
          const dist = 24 + Math.random() * 16;
          sparkles.push({
            startX: targetX + Math.cos(sparkAngle) * dist,
            startY: targetY + Math.sin(sparkAngle) * dist,
            targetX,
            targetY,
            progress: 0,
            size: 1.8 + Math.random() * 1.5,
            color: Math.random() > 0.4 ? '#f59e0b' : '#ffffff',
          });
        }

        onFlightComplete();
      }

      // 绘制冲击波光环
      if (shockwave) {
        shockwave.radius += 1.8;
        shockwave.alpha -= 0.055;
        if (shockwave.alpha > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(shockwave.x, shockwave.y, shockwave.radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(245, 158, 11, ${shockwave.alpha})`;
          ctx.lineWidth = 2;
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 10;
          ctx.stroke();
          ctx.restore();
        } else {
          shockwave = null;
        }
      }

      // 绘制向内坍缩的吸收星芒
      for (let s = sparkles.length - 1; s >= 0; s--) {
        const sp = sparkles[s];
        sp.progress += 0.08;
        if (sp.progress >= 1) {
          sparkles.splice(s, 1);
          continue;
        }
        const curSpX = sp.startX + (sp.targetX - sp.startX) * sp.progress;
        const curSpY = sp.startY + (sp.targetY - sp.startY) * sp.progress;
        const spAlpha = 1 - sp.progress;

        ctx.save();
        ctx.globalAlpha = spAlpha;
        ctx.fillStyle = sp.color;
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(curSpX, curSpY, sp.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (progress < 1 || particles.length > 0 || shockwave || sparkles.length > 0) {
        animId = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    };

    animId = requestAnimationFrame(render);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
  }, [flightPayload, onFlightComplete]);

  if (!flightPayload) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 999999,
      }}
    />
  );
}

// 绘制单张胶囊卡片（配合 GPU Transform 实现无锯齿缩放与形变）
function drawCardCapsule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
  alpha: number,
  text: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scaleX, scaleY);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  const w = width;
  const h = height;
  const radius = h / 2;

  // 1. 发光外阴影
  ctx.shadowColor = 'rgba(245, 158, 11, 0.75)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  // 2. 绘制圆角胶囊
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(-w / 2, -h / 2, w, h, radius);
  } else {
    ctx.rect(-w / 2, -h / 2, w, h);
  }

  // 琥珀金色渐变
  const grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  grad.addColorStop(0, 'rgba(245, 158, 11, 0.95)');
  grad.addColorStop(1, 'rgba(217, 119, 6, 0.92)');
  ctx.fillStyle = grad;
  ctx.fill();

  // 明亮金边
  ctx.strokeStyle = 'rgba(254, 243, 199, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 3. 内部书摘字样与图标
  if (text && scaleX > 0.45 && scaleY > 0.45) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('📌 ' + text, -w / 2 + 12, 0);
  }

  ctx.restore();
}
