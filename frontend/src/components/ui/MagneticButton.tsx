import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  to?: string;
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
  variant?: 'ink' | 'ghost';
  className?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
}

/** Magnetic CTA — pulls toward cursor on hover. */
export function MagneticButton({ to, href, onClick, children, variant = 'ink', className = '', type = 'button', disabled }: Props) {
  const ref = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const STRENGTH = 0.28;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) * STRENGTH;
      const dy = (e.clientY - (r.top + r.height / 2)) * STRENGTH;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const onLeave = () => { el.style.transform = ''; };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const cls = `magnetic ${variant === 'ink' ? 'pill-ink' : 'pill-ghost'} ${disabled ? 'opacity-50 pointer-events-none' : ''} ${className}`;

  if (to) return <Link to={to} ref={ref as any} className={cls} onClick={onClick}>{children}</Link>;
  if (href) return <a href={href} ref={ref as any} className={cls} onClick={onClick}>{children}</a>;
  return <button ref={ref as any} type={type} onClick={onClick} className={cls} disabled={disabled}>{children}</button>;
}
