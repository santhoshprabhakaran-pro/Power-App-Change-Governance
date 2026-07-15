import React, { useId } from 'react';

/* ── Label ── */
interface LabelProps { htmlFor?: string; required?: boolean; children: React.ReactNode; }
export function Label({ htmlFor, required, children }: LabelProps) {
  return (
    <label className="ff-label" htmlFor={htmlFor}>
      {children}
      {required && <span className="ff-required" aria-hidden="true"> *</span>}
    </label>
  );
}

/* ── Field Wrapper — wires label, error, and aria-describedby automatically ── */
interface FieldProps { label: string; required?: boolean; error?: string; hint?: string; htmlFor?: string; children: React.ReactNode; labelSuffix?: React.ReactNode; }
export function Field({ label, required, error, hint, htmlFor, children, labelSuffix }: FieldProps) {
  const errorId = useId();
  const hintId = useId();

  // Clone children to inject aria-describedby, aria-invalid, and aria-required
  const enhancedChildren = React.Children.map(children, child => {
    if (!React.isValidElement(child)) return child;
    const extra: Record<string, unknown> = {};
    if (required) extra['aria-required'] = true;
    if (error) {
      extra['aria-invalid'] = true;
      extra['aria-describedby'] = errorId;
    } else if (hint) {
      extra['aria-describedby'] = hintId;
    }
    return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, extra);
  });

  return (
    <div className={`ff-field ${error ? 'ff-field--error' : ''}`}>
      <Label htmlFor={htmlFor} required={required}>{label}{labelSuffix}</Label>
      {enhancedChildren}
      {hint && !error && <span id={hintId} className="ff-hint">{hint}</span>}
      {error && (
        <span id={errorId} className="ff-error" role="alert">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="ff-error-icon" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          {error}
        </span>
      )}
    </div>
  );
}

/* ── Input ── */
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ error, className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={`ff-input ${error ? 'ff-input--error' : ''} ${className}`}
      aria-invalid={error ? true : undefined}
      {...props}
    />
  )
);
Input.displayName = 'Input';

/* ── Textarea ── */
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, className = '', rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={`ff-input ff-textarea ${error ? 'ff-input--error' : ''} ${className}`}
      aria-invalid={error ? true : undefined}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

/* ── Select ── */
interface SelectOption { value: string | number; label: string; }
interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  placeholder?: string;
  error?: boolean;
}
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, placeholder, error, className = '', ...props }, ref) => (
    <select
      ref={ref}
      className={`ff-input ff-select ${error ? 'ff-input--error' : ''} ${className}`}
      aria-invalid={error ? true : undefined}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
);
Select.displayName = 'Select';

/* ── DateTimeInput ── */
interface DateTimeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}
export const DateTimeInput = React.forwardRef<HTMLInputElement, DateTimeInputProps>(
  ({ error, className = '', ...props }, ref) => (
    <input
      ref={ref}
      type="datetime-local"
      className={`ff-input ${error ? 'ff-input--error' : ''} ${className}`}
      aria-invalid={error ? true : undefined}
      {...props}
    />
  )
);
DateTimeInput.displayName = 'DateTimeInput';

/* ── Toggle ── */
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}
export function Toggle({ checked, onChange, label, disabled, id }: ToggleProps) {
  const generatedId = useId();
  const toggleId = id ?? generatedId;
  return (
    <label className="ff-toggle" htmlFor={toggleId}>
      <input
        id={toggleId}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="ff-toggle__input"
      />
      <span className="ff-toggle__track" aria-hidden="true">
        <span className="ff-toggle__thumb" />
      </span>
      {label && <span className="ff-toggle__label">{label}</span>}
    </label>
  );
}

/* ── SearchInput ── */
interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export function SearchInput({ className = '', ...props }: SearchInputProps) {
  return (
    <div className="ff-search-wrap">
      <svg className="ff-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
      </svg>
      <input className={`ff-input ff-search ${className}`} type="search" {...props} />
    </div>
  );
}

/* ── Form Row (2-col) ── */
export function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="ff-row">{children}</div>;
}

/* ── Section Divider — uses role="heading" for screen reader navigation ── */
interface FormSectionProps { title: string; level?: 2 | 3 | 4 | 5 | 6; }
export function FormSection({ title, level = 3 }: FormSectionProps) {
  const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return <Tag className="ff-section">{title}</Tag>;
}
