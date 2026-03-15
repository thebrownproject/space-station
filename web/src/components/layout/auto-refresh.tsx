"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Auto-refresh the page at a given interval (in seconds). */
export function AutoRefresh({ interval = 30 }: { interval?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, interval * 1000);

    return () => clearInterval(timer);
  }, [interval, router]);

  return null;
}
