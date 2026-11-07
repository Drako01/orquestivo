/** Last segment of a posix or windows style path. */
export const baseName = (relativePath: string): string => relativePath.replace(/\\/g, '/').split('/').pop() ?? '';
