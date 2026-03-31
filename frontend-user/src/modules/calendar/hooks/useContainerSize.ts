'use client';

import type React from 'react';
import { useRef } from 'react';
import { useResizeObserver } from 'usehooks-ts';

export function useContainerSize() {
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = useResizeObserver({
    ref: ref as React.RefObject<HTMLElement>,
    box: 'border-box',
  });
  return { ref, width, height };
}
