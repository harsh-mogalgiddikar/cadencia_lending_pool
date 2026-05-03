import { useEffect, useRef } from 'react';

/** Reveals element on scroll-into-view via IntersectionObserver. */
export function Reveal({ children, delay = 0, className = '', as: As = 'div' }: { children: React.ReactNode; delay?: number; className?: string; as?: any }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setTimeout(() => el.classList.add('in'), delay);
        io.disconnect();
      }
    }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return <As ref={ref as any} className={`reveal ${className}`}>{children}</As>;
}
