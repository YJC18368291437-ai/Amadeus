import { useEffect, useRef } from 'react';
import { wheelZoomStep } from './zoom.mjs';

export function useCtrlWheelZoom(elementRef, onStep, step = .1) {
  const current = useRef({ onStep, step });
  current.current = { onStep, step };
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const zoom = event => {
      if (!event.ctrlKey) return;
      const delta = wheelZoomStep(event.deltaY, current.current.step);
      if (!delta) return;
      event.preventDefault();
      current.current.onStep(delta);
    };
    element.addEventListener('wheel', zoom, { passive: false });
    return () => element.removeEventListener('wheel', zoom);
  }, [elementRef]);
}
