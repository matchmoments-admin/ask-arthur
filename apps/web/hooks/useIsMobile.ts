"use client";

import { useSyncExternalStore } from "react";

const MQ = "(hover: none) and (pointer: coarse)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(MQ);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "ontouchstart" in window ||
    window.matchMedia(MQ).matches ||
    navigator.maxTouchPoints > 0
  );
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
