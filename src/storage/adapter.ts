import type { DataFile } from '../domain/files';

export interface StorageAdapter {
  /** Reads a data file. Throws NotFoundError if it doesn't exist yet. */
  readJson<T>(name: DataFile): Promise<{ data: T; version: string }>;
  /**
   * Writes a data file. If the file's current version differs from
   * `expectedVersion`, throws ConflictError without writing. Pass
   * `expectedVersion: null` to create a file that must not exist yet.
   */
  writeJson<T>(name: DataFile, data: T, expectedVersion: string | null): Promise<{ version: string }>;
  uploadImage(path: string, blob: Blob): Promise<{ fileId: string }>;
  /** Object URL for display. The caller revokes it when done. */
  getImageUrl(fileId: string): Promise<string>;
  /** Removes an uploaded image (used by undo of a receipt scan). */
  deleteImage?(fileId: string): Promise<void>;
}

export class ConflictError extends Error {
  constructor(public file: DataFile) {
    super(`${file} was changed by someone else`);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(public file: DataFile) {
    super(`${file} doesn't exist yet`);
    this.name = 'NotFoundError';
  }
}

export class AuthError extends Error {
  constructor(message = 'Your Google session has expired') {
    super(message);
    this.name = 'AuthError';
  }
}
