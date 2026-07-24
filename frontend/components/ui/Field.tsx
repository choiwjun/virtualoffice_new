'use client';

/**
 * Field — Input/Textarea/Select + Label 프리미티브 (감사 23 A5/C9).
 *
 * 이전엔 인풋/셀렉트/텍스트에어리어가 페이지마다 className 손복사라 포커스·disabled·invalid 상태가
 * 제각각이고 label-input 연결(htmlFor)이 누락되기도 했다. 이 프리미티브로 표준화한다.
 * 색은 디자인 토큰(CSS 변수) → 화이트라벨 자동 반영.
 */

import React, { useId } from 'react';

const CONTROL =
  'w-full rounded-lg bg-bg-base border border-border-subtle text-sm text-text-primary placeholder:text-text-muted ' +
  'px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus:border-primary/50 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-danger';

/** 라벨 + 컨트롤 래퍼 — htmlFor 자동 연결(C9). */
export function Label({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label?: string;
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-text-secondary">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      {children}
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className = '', ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={`${CONTROL} ${className}`} {...rest} />;
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className = '', ...rest },
  ref,
) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={`${CONTROL} resize-y ${className}`} {...rest} />;
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className = '', children, ...rest },
  ref,
) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={`${CONTROL} ${className}`} {...rest}>
      {children}
    </select>
  );
});

/** 라벨+Input을 한 번에 — id 자동 생성으로 htmlFor 연결(C9). */
export function LabeledInput({
  label,
  hint,
  required,
  invalid,
  id,
  ...rest
}: InputProps & { label?: string; hint?: string }) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Label label={label} htmlFor={fieldId} hint={hint} required={required}>
      <Input id={fieldId} invalid={invalid} required={required} {...rest} />
    </Label>
  );
}
