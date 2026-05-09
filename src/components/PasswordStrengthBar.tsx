'use client';

import { checkPassword } from '@/lib/password-policy';

interface Props {
  password: string;
  className?: string;
}

export default function PasswordStrengthBar({ password, className = '' }: Props) {
  if (!password) return null;

  const { strength, errors, valid } = checkPassword(password);

  const segments = 3;
  const filled = strength === 'strong' ? 3 : strength === 'fair' ? 2 : 1;

  const color =
    strength === 'strong' ? 'bg-emerald-500' :
    strength === 'fair'   ? 'bg-amber-400'   :
                            'bg-red-400';

  const label =
    strength === 'strong' ? 'Strong' :
    strength === 'fair'   ? 'Fair'   :
                            'Weak';

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex gap-1">
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
              i < filled ? color : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-medium ${
          strength === 'strong' ? 'text-emerald-600' :
          strength === 'fair'   ? 'text-amber-600'   :
                                  'text-red-500'
        }`}>
          {label}
        </p>
        {!valid && errors.length > 0 && (
          <p className="text-xs text-gray-400">{errors[0]}</p>
        )}
      </div>
    </div>
  );
}
