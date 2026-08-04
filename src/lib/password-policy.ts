/**
 * Password policy shared between server-side API routes and client-side UI.
 *
 * Rules (in order of display):
 *  1. At least 12 characters
 *  2. At least one letter
 *  3. At least one number
 *  4. Not in the common-passwords list
 *
 * Baseline chosen to align with industry standards: 12-character minimum with
 * letters + numbers (PCI-DSS v4) plus a common/breached-password block (NIST
 * 800-63B). Supabase Auth is configured to match (min length 12, letters +
 * digits required, HaveIBeenPwned breach check enabled) for any auth.users.
 *
 * Designed to be importable in both Node.js API routes and browser
 * React components (no Node-only APIs used).
 */

// Top-100 most commonly used passwords. Enough to block the obvious
// choices without the overhead of a full HaveIBeenPwned API call.
const COMMON_PASSWORDS = new Set([
  'password','password1','password123','12345678','123456789','1234567890',
  'qwerty123','qwerty','qwertyuiop','iloveyou','admin123','letmein',
  'welcome1','monkey123','dragon123','master123','abc123456','pass1234',
  'sunshine','princess','shadow123','superman','michael1','football',
  'baseball','soccer123','hockey123','batman123','trustno1','starwars',
  'login123','hello123','summer23','winter23','spring23','autumn23',
  'january1','february','march123','april123','may12345','june1234',
  'july1234','august12','september','october1','november','december',
  'qazwsxedc','zxcvbnm1','asdfghjk','mnbvcxz1','1q2w3e4r','1qaz2wsx',
  'passw0rd','p@ssword','p@ssw0rd','passw0rd1','password!','Password1',
  'Password!','P@ssword','P@ssw0rd','Pa$$word','pass@123','Test1234',
  'changeme','changeme1','Welcome1','Welcome!','Admin123','Admin@123',
  'root1234','toor1234','user1234','guest123','demo1234','temp1234',
  'access14','access12','696969','123123123','111111111','000000000',
  'aaaaaa12','1111111a','11111111','00000000','99999999','12345abc',
  'abcdefg1','abcd1234','abc12345','a1b2c3d4','1a2b3c4d','qwerty1',
  'iloveyou1','iloveu12','loveyou1','baby1234','angel123','flower12',
]);

export interface PasswordCheckResult {
  valid:    boolean;
  strength: 'weak' | 'fair' | 'strong';
  errors:   string[];
  /** Single sentence suitable for a toast / API error response. */
  message:  string;
}

export function checkPassword(password: string): PasswordCheckResult {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('At least 12 characters');
  }
  if (!/[a-zA-Z]/.test(password)) {
    errors.push('At least one letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('At least one number');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('Too common — choose a unique password');
  }

  const valid = errors.length === 0;

  // Strength meter (length is the dominant factor). Character-class variety
  // (lower / upper / digit / symbol) is encouraged for a "strong" rating but
  // not required to pass.
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ].filter(Boolean).length;

  let strength: 'weak' | 'fair' | 'strong' = 'weak';
  if (valid && (password.length >= 16 || (password.length >= 14 && classes >= 3))) strength = 'strong';
  else if (valid) strength = 'fair';

  const message = errors.length > 0
    ? `Password must have: ${errors.join(', ').toLowerCase()}.`
    : '';

  return { valid, strength, errors, message };
}
