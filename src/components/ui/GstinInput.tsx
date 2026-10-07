import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { checkGstin } from '../../lib/gstin';
import { cn } from '../../lib/utils';
import controls from '../../styles/controls.module.css';

export interface GstinInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with the two-digit state code once a structurally valid GSTIN is typed. */
  onStateCode?: (code: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
}

/** GSTIN field with an offline checksum check; stays quiet until the user has finished typing. */
export function GstinInput({ value, onChange, onStateCode, placeholder = '22AAAAA0000A1Z5', id, className }: GstinInputProps) {
  const [touched, setTouched] = useState(false);
  const result = checkGstin(value);
  const showResult = value.length > 0 && (touched || value.length >= 15);

  return (
    <>
      <input
        id={id}
        className={cn(controls.input, controls.inputMono, showResult && !result.valid && controls.inputInvalid, className)}
        value={value}
        maxLength={15}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="characters"
        aria-invalid={showResult && !result.valid}
        onBlur={() => setTouched(true)}
        onChange={(e) => {
          const next = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
          onChange(next);
          const check = checkGstin(next);
          if (check.valid && check.stateCode) onStateCode?.(check.stateCode);
        }}
      />
      {showResult &&
        (result.valid ? (
          <span className={controls.ok}>
            <CheckCircle2 size={13} /> Valid GSTIN
          </span>
        ) : (
          <span className={controls.error}>
            <XCircle size={13} /> {result.message}
          </span>
        ))}
    </>
  );
}
