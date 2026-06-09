import { useEffect } from 'react';
import { playSound } from '../utils/soundEngine';

export function useClickSound(enabled: boolean): void {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if ((e.target as HTMLElement).closest('button, a')) {
        playSound(enabled, 'click');
      }
    }
    document.addEventListener('click', handleClick, { capture: true });
    return () => document.removeEventListener('click', handleClick, { capture: true });
  }, [enabled]);
}
