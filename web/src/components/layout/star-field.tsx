"use client";

import { useEffect, useRef } from "react";

export function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    const stars: Array<{ x: number; y: number; size: number; speed: number; opacity: number; hue: number }> = [];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }

    function initStars() {
      stars.length = 0;
      const count = Math.floor((canvas!.width * canvas!.height) / 12000);
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * canvas!.width,
          y: Math.random() * canvas!.height,
          size: Math.random() * 1.2 + 0.3,
          speed: Math.random() * 0.08 + 0.01,
          opacity: Math.random() * 0.4 + 0.1,
          hue: Math.random() > 0.85 ? 185 : Math.random() > 0.7 ? 45 : 210, // mostly cool blue, some cyan, rare amber
        });
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      for (const star of stars) {
        star.opacity += (Math.random() - 0.5) * 0.01;
        star.opacity = Math.max(0.05, Math.min(0.5, star.opacity));
        star.y += star.speed;
        if (star.y > canvas!.height) {
          star.y = 0;
          star.x = Math.random() * canvas!.width;
        }

        ctx!.beginPath();
        ctx!.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${star.hue}, 60%, 75%, ${star.opacity})`;
        ctx!.fill();
      }

      animationId = requestAnimationFrame(draw);
    }

    resize();
    initStars();
    draw();

    const onResize = () => { resize(); initStars(); };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.3 }}
    />
  );
}
