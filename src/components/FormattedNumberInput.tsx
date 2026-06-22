import { useState, useEffect } from 'react';

export function FormattedNumberInput({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: number | null;
  onChange: (val: number | null) => void;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value != null ? value.toLocaleString('en-US') : '');

  useEffect(() => {
    if (value == null) {
      setDraft('');
    } else {
      const draftNum = Number(draft.replace(/,/g, ''));
      if (draftNum !== value) {
        setDraft(value.toLocaleString('en-US'));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => {
        const val = e.target.value;
        // Allow digits, commas, and decimal points
        if (!/^[0-9.,]*$/.test(val)) return;
        setDraft(val);
        const cleaned = val.replace(/,/g, '');
        if (cleaned === '' || cleaned === '.') {
          onChange(null);
        } else {
          const num = Number(cleaned);
          if (!Number.isNaN(num)) {
            onChange(num);
          }
        }
      }}
      onBlur={() => {
        if (value != null) {
          setDraft(value.toLocaleString('en-US'));
        } else {
          setDraft('');
        }
      }}
    />
  );
}
