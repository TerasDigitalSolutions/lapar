import type { ComponentProps } from 'react';

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600';

const variants = {
  primary: 'bg-orange-600 text-white hover:bg-orange-700 active:bg-orange-800',
  secondary: 'border border-stone-300 bg-white text-stone-900 hover:bg-stone-50 active:bg-stone-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
  ghost: 'text-stone-800 hover:bg-stone-100 active:bg-stone-200',
} as const;

export type ButtonVariant = keyof typeof variants;

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  /** Stretch to the container width (typical on phones). */
  block?: boolean;
}

export function Button({ variant = 'primary', block, className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${variants[variant]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    />
  );
}

/** Square icon-only button. `label` is required: it is the accessible name. */
export function IconButton({
  label,
  variant = 'ghost',
  className = '',
  type = 'button',
  children,
  ...rest
}: Omit<ButtonProps, 'block' | 'aria-label'> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-xl transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${variants[variant]} ${className}`}
      {...rest}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
