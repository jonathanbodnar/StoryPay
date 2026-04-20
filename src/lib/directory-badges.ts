export const DIRECTORY_BADGE_STATUSES = ['none', 'draft', 'pending', 'approved', 'rejected'] as const;
export type DirectoryBadgeStatus = (typeof DIRECTORY_BADGE_STATUSES)[number];

export function isDirectoryBadgeStatus(v: string | null | undefined): v is DirectoryBadgeStatus {
  return DIRECTORY_BADGE_STATUSES.includes(v as DirectoryBadgeStatus);
}

/** Public directory / API: show Instagram-style verified badge */
export function isPublicVerifiedStatus(status: string | null | undefined): boolean {
  return status === 'approved';
}

/** Public directory / API: show "Sponsored" label */
export function isPublicSponsoredStatus(status: string | null | undefined): boolean {
  return status === 'approved';
}

export function directoryBadgeLabel(status: string): string {
  switch (status) {
    case 'none':
      return 'None';
    case 'draft':
      return 'Draft';
    case 'pending':
      return 'Pending';
    case 'approved':
      return 'Approved (live)';
    case 'rejected':
      return 'Rejected';
    default:
      return status;
  }
}
