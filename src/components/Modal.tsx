import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose?: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-labelledby={heading} onCancel={event => { event.preventDefault(); onClose?.(); }}>
    {onClose && <button className="modal-close icon-button" aria-label="关闭弹窗" onClick={onClose}><Icon name="close" /></button>}
    <h2 id={heading}>{title}</h2>
    {children}
  </dialog>;
}
