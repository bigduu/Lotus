const versionsByRequestId = new Map<string, number>();

/** Drops duplicate/out-of-order approval lifecycle frames within this client process. */
export const acceptChildApprovalVersion = (key: string, version?: number): boolean => {
  if (version === undefined) return true;
  const current = versionsByRequestId.get(key);
  if (current !== undefined && version <= current) return false;
  versionsByRequestId.set(key, version);
  return true;
};
