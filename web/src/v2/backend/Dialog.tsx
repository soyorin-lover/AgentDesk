import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

/* ─────────────────────────────────────────────────────────────
   模态对话框
   - Esc 只关闭最上层（由 useTopLayer 计数保证）
   - Tab / Shift+Tab 焦点锁在弹窗内
   - 关闭后焦点回到触发元素
   - 打开期间键盘事件不再落到背景
   ───────────────────────────────────────────────────────────── */

/** 打开的模态栈。栈顶才是「最上层」，Esc 只作用于它。 */
const stack: number[] = [];
let seq = 0;

export function topLayerId(): number | null {
  return stack.length ? stack[stack.length - 1] : null;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  children,
  footer,
  onClose,
  labelledBy,
  wide,
}: {
  title: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  labelledBy?: string;
  wide?: boolean;
}) {
  const titleId = useId();
  const headingId = labelledBy ?? titleId;
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef<number>(-1);
  const restore = useRef<HTMLElement | null>(null);

  /* 记录触发元素，关闭后把焦点还回去 */
  useEffect(() => {
    const active = document.activeElement;
    restore.current = active instanceof HTMLElement ? active : null;
  }, []);

  /* 入栈 / 出栈 */
  useEffect(() => {
    id.current = ++seq;
    stack.push(id.current);
    return () => {
      const i = stack.indexOf(id.current);
      if (i >= 0) stack.splice(i, 1);
      // 焦点回到触发按钮；元素可能已经不在文档里（例如面板被关掉）
      const el = restore.current;
      if (el && document.contains(el)) el.focus();
    };
  }, []);

  /* 打开时把焦点移进弹窗（优先第一个可聚焦元素） */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el).focus();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const el = ref.current;
      if (!el) return;

      if (e.key === 'Escape') {
        // 只有最上层处理 Esc；否则会连带关掉下面的浮层面板
        if (topLayerId() !== id.current) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // 焦点不在弹窗内（或落在非可聚焦容器上）时，拉回第一个
      if (!el.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && topLayerId() === id.current) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={ref}
        tabIndex={-1}
        style={wide ? { width: 'min(560px, calc(100vw - 32px))' } : undefined}
      >
        <button className="icon-btn dialog-close" aria-label="关闭弹窗" onClick={onClose}><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8"/></svg></button><h2 id={headingId}>{title}</h2>
        {children}
        <div className="dialog__foot">{footer}</div>
      </div>
    </div>
  );
}
