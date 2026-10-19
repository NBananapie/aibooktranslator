"use client";

import React, { useEffect, useRef } from 'react';

export interface FlightPayload {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  text: string;
}

export interface ClipFlightCanvasProps {
  flightPayload: FlightPayload | null;
  onAbsorb?: () => void;
  onFlightComplete: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface ActiveSlice {
  index: number;
  u: number;
  xCenter: number;
  yTop: number;
  yBot: number;
  p: number;
  currentH: number;
}

interface StardustParticle {
  tau: number;
  dtau: number;
  offsetY: number;
  size: number;
  color: string;
  alpha: number;
}

interface ShockwaveRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

interface InwardRay {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  progress: number;
  size: number;
  color: string;
}

// 三次贝塞尔曲线坐标求解
function getCubicBezierPoint(p: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const c = 1 - p;
  const c2 = c * c;
  const c3 = c2 * c;
  const p2_ = p * p;
  const p3_ = p2_ * p;

  return {
    x: c3 * p0.x + 3 * c2 * p * p1.x + 3 * c * p2_ * p2.x + p3_ * p3.x,
    y: c3 * p0.y + 3 * c2 * p * p1.y + 3 * c * p2_ * p2.y + p3_ * p3.y,
  };
}

// 离屏渲染书摘卡片纹理（Retina 高清抗锯齿与晶莹质感）
function createCardOffscreenCanvas(
  previewText: string,
  cardW: number,
  cardH: number,
  dpr: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(cardW * dpr);
  canvas.height = Math.ceil(cardH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.scale(dpr, dpr);

  const r = 10;

  // 1. 卡片主体背景（琥珀金渐变）
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(1, 1, cardW - 2, cardH - 2, r);
  } else {
    ctx.rect(1, 1, cardW - 2, cardH - 2);
  }

  const bgGrad = ctx.createLinearGradient(0, 0, cardW, cardH);
  bgGrad.addColorStop(0, '#f59e0b');
  bgGrad.addColorStop(0.5, '#ea580c');
  bgGrad.addColorStop(1, '#d97706');
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // 2. 顶部高光镜面反射（macOS Aqua 质感）
  const glossGrad = ctx.createLinearGradient(0, 0, 0, cardH * 0.55);
  glossGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
  glossGrad.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
  ctx.fillStyle = glossGrad;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(1.5, 1.5, cardW - 3, (cardH - 3) * 0.5, [r - 1, r - 1, 0, 0]);
  } else {
    ctx.rect(1.5, 1.5, cardW - 3, (cardH - 3) * 0.5);
  }
  ctx.fill();

  // 3. 晶透金边
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(1, 1, cardW - 2, cardH - 2, r);
  } else {
    ctx.rect(1, 1, cardW - 2, cardH - 2);
  }
  ctx.strokeStyle = 'rgba(254, 243, 199, 0.95)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  // 4. 书摘图标与字样
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.fillText('📌 ' + previewText, 12, cardH / 2);
  ctx.restore();

  return canvas;
}

export function ClipFlightCanvas({
  flightPayload,
  onAbsorb,
  onFlightComplete,
}: ClipFlightCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!flightPayload) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animId: number;
    const startTime = performance.now();
    const DURATION = 580; // 580ms macOS 神奇效果标准时长
    const SLICE_COUNT = 96; // 96 条扫描切片，形成完全平滑的连续流体曲面

    const { startX, startY, targetX, targetY, text } = flightPayload;

    // 自适应高清屏幕缩放
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);

    // 卡片尺寸与离屏纹理生成
    const cleanText = text.trim();
    const previewText = cleanText.length > 15 ? cleanText.slice(0, 15) + '...' : cleanText;
    const cardW = Math.min(260, Math.max(150, previewText.length * 11 + 44));
    const cardH = 36;
    const offscreenCanvas = createCardOffscreenCanvas(previewText, cardW, cardH, dpr);

    // 方向判定：目标点是否在选区右侧（通常侧边栏在右侧，isTargetOnRight = true）
    const isTargetOnRight = targetX >= startX;
    const cardLeft0 = startX - cardW / 2;

    // 烟雾漏斗 S-Curve 轨迹几何控制点
    const deltaX = targetX - startX;
    const deltaY = targetY - startY;
    const crestY =
      Math.abs(deltaY) < 5
        ? -18
        : deltaY > 0
        ? -Math.min(32, Math.max(14, deltaY * 0.22))
        : Math.min(32, Math.max(14, Math.abs(deltaY) * 0.22));

    // 星尘流与落地冲击波
    const stardust: StardustParticle[] = [];
    let shockwave: ShockwaveRing | null = null;
    let inwardRays: InwardRay[] = [];
    let hasTriggeredAbsorb = false;

    const render = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / DURATION);

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // 1. 遍历所有切片，计算当前时刻各切片的形变与漏斗坐标
      const activeSlices: ActiveSlice[] = [];

      for (let i = 0; i < SLICE_COUNT; i++) {
        const u = i / (SLICE_COUNT - 1); // 0 = 最左边, 1 = 最右边
        // 距离先行端（迎着目标点的一端）的归一化距离
        const distToLead = isTargetOnRight ? 1 - u : u;

        // macOS 神奇效果时间方程：先行端 0ms 出发并在 35% 时刻率先抵达把手锚定，后续切片依次被吸入
        const tStart = Math.pow(distToLead, 1.35) * 0.22;
        const tReach = 0.35 + Math.pow(distToLead, 0.88) * 0.65;

        // 若当前时刻已超过该切片的抵达时间，该切片已完全吸入消失
        if (t >= tReach) {
          continue;
        }

        // 计算切片局部插值进度 p
        let p = 0;
        if (t > tStart) {
          const tau = (t - tStart) / (tReach - tStart);
          p = Math.pow(tau, 1.4); // 高速向漏斗颈部加速吸入
        }

        // 起点与终点
        const p0: Point = {
          x: cardLeft0 + u * cardW,
          y: startY,
        };
        const p3: Point = {
          x: targetX,
          y: targetY,
        };

        const sliceDx = p3.x - p0.x;
        const sliceDy = p3.y - p0.y;

        // S 型流体漏斗中继控制点
        const p1: Point = {
          x: p0.x + sliceDx * 0.38,
          y: p0.y + sliceDy * 0.06 + crestY,
        };
        const p2: Point = {
          x: p0.x + sliceDx * 0.74,
          y: p3.y - sliceDy * 0.1,
        };

        const centerPt = getCubicBezierPoint(p, p0, p1, p2, p3);

        // macOS 漏斗收窄方程：越靠近把手颈部，高度呈非线性极速收窄至 0
        const currentH = Math.max(1, cardH * (1 - Math.pow(p, 1.85)));
        const yTop = centerPt.y - currentH / 2;
        const yBot = centerPt.y + currentH / 2;

        activeSlices.push({
          index: i,
          u,
          xCenter: centerPt.x,
          yTop,
          yBot,
          p,
          currentH,
        });
      }

      // 2. 绘制漏斗切片网格（GPU 硬件加速与相邻切片无缝重叠覆盖）
      if (activeSlices.length > 0) {
        for (let k = 0; k < activeSlices.length; k++) {
          const slice = activeSlices[k];
          const srcX = (slice.index / SLICE_COUNT) * cardW;
          const srcW = cardW / SLICE_COUNT;
          const srcY = 0;
          const srcH = cardH;

          const destX = slice.xCenter;
          const destY = slice.yTop;
          const destH = Math.max(1, slice.yBot - slice.yTop);

          let destW = 2;
          if (isTargetOnRight) {
            if (k < activeSlices.length - 1) {
              destW = Math.max(1.2, activeSlices[k + 1].xCenter - slice.xCenter + 0.6);
            } else {
              // 处于最右侧的活跃切片
              if (slice.index === SLICE_COUNT - 1) {
                destW = Math.max(1.5, (cardW / SLICE_COUNT) * (1 - slice.p * 0.7));
              } else {
                // 先行端已抵达把手，末尾切片平滑贴合至目标把手点
                destW = Math.max(1.5, targetX - slice.xCenter);
              }
            }
          } else {
            if (k > 0) {
              destW = Math.max(1.2, slice.xCenter - activeSlices[k - 1].xCenter + 0.6);
            } else {
              if (slice.index === 0) {
                destW = Math.max(1.5, (cardW / SLICE_COUNT) * (1 - slice.p * 0.7));
              } else {
                destW = Math.max(1.5, slice.xCenter - targetX);
              }
            }
          }

          ctx.drawImage(offscreenCanvas, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
        }

        // 3. 绘制流体漏斗的外轮廓流光（Luminous Funnel Contour Spline）
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(activeSlices[0].xCenter, activeSlices[0].yTop);
        for (let k = 1; k < activeSlices.length; k++) {
          ctx.lineTo(activeSlices[k].xCenter, activeSlices[k].yTop);
        }
        if (isTargetOnRight && activeSlices[activeSlices.length - 1].index < SLICE_COUNT - 1) {
          ctx.lineTo(targetX, targetY);
        }
        for (let k = activeSlices.length - 1; k >= 0; k--) {
          ctx.lineTo(activeSlices[k].xCenter, activeSlices[k].yBot);
        }
        ctx.closePath();

        // 描金流光边框
        ctx.strokeStyle = 'rgba(254, 243, 199, 0.95)';
        ctx.lineWidth = 1.2;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 8;
        ctx.stroke();

        // 漏斗内部晶透金光覆层
        const sheen = ctx.createLinearGradient(activeSlices[0].xCenter, startY, targetX, targetY);
        sheen.addColorStop(0, 'rgba(251, 191, 36, 0.08)');
        sheen.addColorStop(0.7, 'rgba(245, 158, 11, 0.22)');
        sheen.addColorStop(1, 'rgba(254, 243, 199, 0.4)');
        ctx.fillStyle = sheen;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fill();
        ctx.restore();
      }

      // 4. 漏斗通道星尘粒子流（Magic Lamp Stardust）
      if (t > 0.12 && t < 0.95) {
        if (Math.random() < 0.8) {
          stardust.push({
            tau: 0.15 + Math.random() * 0.45,
            dtau: 0.02 + Math.random() * 0.025,
            offsetY: (Math.random() - 0.5) * 14,
            size: 1.5 + Math.random() * 2,
            color: Math.random() > 0.35 ? '#fbbf24' : '#ffffff',
            alpha: 0.9,
          });
        }
      }

      // 更新并渲染漏斗星尘
      for (let s = stardust.length - 1; s >= 0; s--) {
        const star = stardust[s];
        star.tau += star.dtau;
        star.alpha -= 0.02;

        if (star.tau >= 1 || star.alpha <= 0) {
          stardust.splice(s, 1);
          continue;
        }

        const midP0: Point = { x: startX, y: startY };
        const midP3: Point = { x: targetX, y: targetY };
        const midDx = midP3.x - midP0.x;
        const midDy = midP3.y - midP0.y;
        const midP1: Point = { x: midP0.x + midDx * 0.38, y: midP0.y + midDy * 0.06 + crestY };
        const midP2: Point = { x: midP0.x + midDx * 0.74, y: midP3.y - midDy * 0.1 };

        const starPt = getCubicBezierPoint(star.tau, midP0, midP1, midP2, midP3);
        const taper = 1 - Math.pow(star.tau, 1.8);
        const finalStarY = starPt.y + star.offsetY * taper;

        ctx.save();
        ctx.globalAlpha = star.alpha;
        ctx.fillStyle = star.color;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(starPt.x, finalStarY, star.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 5. 吸收奇点瞬间：在 t >= 1 时触发把手共振冲击波与内聚光芒
      if (t >= 1 && !hasTriggeredAbsorb) {
        hasTriggeredAbsorb = true;
        onAbsorb?.();

        shockwave = {
          x: targetX,
          y: targetY,
          radius: 3,
          maxRadius: 36,
          alpha: 0.95,
        };

        for (let m = 0; m < 12; m++) {
          const rayAngle = (Math.PI * 2 * m) / 12 + Math.random() * 0.2;
          const rayDist = 22 + Math.random() * 14;
          inwardRays.push({
            x: targetX + Math.cos(rayAngle) * rayDist,
            y: targetY + Math.sin(rayAngle) * rayDist,
            targetX,
            targetY,
            progress: 0,
            size: 1.8 + Math.random() * 1.4,
            color: Math.random() > 0.4 ? '#f59e0b' : '#ffffff',
          });
        }
      }

      // 渲染金色共振冲击波
      if (shockwave) {
        shockwave.radius += 2.2;
        shockwave.alpha -= 0.055;
        if (shockwave.alpha > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(shockwave.x, shockwave.y, shockwave.radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(245, 158, 11, ${shockwave.alpha})`;
          ctx.lineWidth = 2.2;
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 10;
          ctx.stroke();
          ctx.restore();
        } else {
          shockwave = null;
        }
      }

      // 渲染向内坍缩的内聚星芒
      for (let rIdx = inwardRays.length - 1; rIdx >= 0; rIdx--) {
        const ray = inwardRays[rIdx];
        ray.progress += 0.09;
        if (ray.progress >= 1) {
          inwardRays.splice(rIdx, 1);
          continue;
        }
        const curRx = ray.x + (ray.targetX - ray.x) * ray.progress;
        const curRy = ray.y + (ray.targetY - ray.y) * ray.progress;
        const rayAlpha = 1 - ray.progress;

        ctx.save();
        ctx.globalAlpha = rayAlpha;
        ctx.fillStyle = ray.color;
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(curRx, curRy, ray.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 循环或结束收尾
      if (t < 1 || stardust.length > 0 || shockwave || inwardRays.length > 0) {
        animId = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        onFlightComplete();
      }
    };

    animId = requestAnimationFrame(render);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
  }, [flightPayload, onAbsorb, onFlightComplete]);

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
