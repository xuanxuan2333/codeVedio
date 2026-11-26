import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

export const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const ease = Easing.inOut(Easing.cubic);
  const seg = (a: number, b: number) =>
    interpolate(t, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

  const move = seg(0.2, 1.7);      // 平移
  const spin = seg(1.7, 2.7);      // 旋转
  const grow = seg(2.7, 3.7);      // 缩放
  const pop  = seg(3.7, 4.6);      // 变色 + 文字

  const x = -380 + move * 380;
  const deg = spin * 45;
  const scale = 1 + grow * 0.35;
  const hue = 212 + pop * 60;

  return (
    <AbsoluteFill style={{ background: '#0b0d12', fontFamily: 'PingFang SC, sans-serif' }}>
      <AbsoluteFill style={{ placeItems: 'center', display: 'grid' }}>
        <div style={{
          width: 260, height: 170, borderRadius: 20,
          border: `3px solid hsl(${hue} 85% 62%)`,
          background: `hsl(${hue} 85% 22% / 0.35)`,
          transform: `translateX(${x}px) rotate(${deg}deg) scale(${scale})`,
          boxShadow: `0 24px 60px -20px hsl(${hue} 85% 55% / ${0.25 + pop * 0.45})`,
        }} />
      </AbsoluteFill>
      <div style={{
        position: 'absolute', bottom: 64, width: '100%', textAlign: 'center',
        fontFamily: 'SF Mono, Menlo, monospace', fontSize: 34, letterSpacing: 1,
        color: '#e6edf3', opacity: pop,
        transform: `translateY(${(1 - pop) * 18}px)`,
      }}>
        translate → rotate → scale
      </div>
    </AbsoluteFill>
  );
};
