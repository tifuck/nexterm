import { create } from 'zustand';
import { apiGet, apiPost, apiPut, apiDelete, apiUpload } from '../api/client';
import type { Session, Folder } from '../types/session';

/** Encrypted credential blobs returned by the credentials endpoint. */
export interface SessionCredentials {
  id: string;
  encrypted_password?: string | null;
  encrypted_ssh_key?: string | null;
  encrypted_passphrase?: string | null;
}

/** A single parsed session from an import file preview. */
export interface ImportedSession {
  name: string;
  session_type: string;
  host: string;
  port: number;
  username?: string | null;
  folder_path?: string | null;
}

/** Result of an import operation. */
export interface ImportResult {
  sessions_created: number;
  folders_created: number;
  skipped: number;
  warnings: string[];
}

/** Preview of sessions parsed from a file. */
export interface ImportPreview {
  format_detected: string;
  sessions: ImportedSession[];
  warnings: string[];
}

interface SessionState {
  sessions: Session[];
  folders: Folder[];
  isLoading: boolean;
  fetchSessions: () => Promise<void>;
  fetchFolders: () => Promise<void>;
  createSession: (data: Partial<Session>) => Promise<Session>;
  updateSession: (id: string, data: Partial<Session>) => Promise<Session>;
  deleteSession: (id: string) => Promise<void>;
  duplicateSession: (id: string) => Promise<Session>;
  createFolder: (data: Partial<Folder>) => Promise<Folder>;
  updateFolder: (id: string, data: Partial<Folder>) => Promise<Folder>;
  deleteFolder: (id: string) => Promise<void>;
  /** Move one or more sessions into a folder (or to root if folderId is null). */
  moveSessions: (sessionIds: string[], folderId: string | null) => Promise<void>;
  /** Import sessions from an uploaded file. */
  importSessions: (file: File) => Promise<ImportResult>;
  /** Preview sessions from an import file without saving. */
  previewImport: (file: File) => Promise<ImportPreview>;
  /** Fetch client-side encrypted credential blobs for a single session. */
  fetchCredentials: (id: string) => Promise<SessionCredentials>;
  /** Fetch client-side encrypted credential blobs for all user sessions. */
  fetchAllCredentials: () => Promise<SessionCredentials[]>;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  folders: [],
  isLoading: false,

  fetchSessions: async () => {
    set({ isLoading: true });
    try {
      const data = await apiGet('/api/sessions');
      set({ sessions: data.sessions ?? data, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchFolders: async () => {
    set({ isLoading: true });
    try {
      const data = await apiGet('/api/folders');
      set({ folders: data.folders ?? data, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  createSession: async (data: Partial<Session>) => {
    const result = await apiPost('/api/sessions', data);
    const session: Session = result.session ?? result;
    set((state) => ({ sessions: [...state.sessions, session] }));
    return session;
  },

  updateSession: async (id: string, data: Partial<Session>) => {
    const result = await apiPut(`/api/sessions/${id}`, data);
    const session: Session = result.session ?? result;
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? session : s)),
    }));
    return session;
  },

  deleteSession: async (id: string) => {
    await apiDelete(`/api/sessions/${id}`);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    }));
  },

  duplicateSession: async (id: string) => {
    const result = await apiPost(`/api/sessions/${id}/duplicate`);
    const session: Session = result.session ?? result;
    set((state) => ({ sessions: [...state.sessions, session] }));
    return session;
  },

  createFolder: async (data: Partial<Folder>) => {
    const result = await apiPost('/api/folders', data);
    const folder: Folder = result.folder ?? result;
    set((state) => ({ folders: [...state.folders, folder] }));
    return folder;
  },

  updateFolder: async (id: string, data: Partial<Folder>) => {
    const result = await apiPut(`/api/folders/${id}`, data);
    const folder: Folder = result.folder ?? result;
    set((state) => ({
      folders: state.folders.map((f) => (f.id === id ? folder : f)),
    }));
    return folder;
  },

  deleteFolder: async (id: string) => {
    await apiDelete(`/api/folders/${id}`);
    set((state) => ({
      folders: state.folders.filter((f) => f.id !== id),
      // Move sessions from deleted folder to root
      sessions: state.sessions.map((s) =>
        s.folder_id === id ? { ...s, folder_id: undefined } : s
      ),
    }));
  },

  moveSessions: async (sessionIds: string[], folderId: string | null) => {
    await apiPut('/api/sessions/move', { session_ids: sessionIds, folder_id: folderId });
    set((state) => ({
      sessions: state.sessions.map((s) =>
        sessionIds.includes(s.id) ? { ...s, folder_id: folderId ?? undefined } : s
      ),
    }));
  },

  importSessions: async (file: File) => {
    const result = await apiUpload<ImportResult>('/api/sessions/import', file);
    // Refresh both sessions and folders after import
    const sessions = await apiGet('/api/sessions');
    const folders = await apiGet('/api/folders');
    set({
      sessions: sessions.sessions ?? sessions,
      folders: folders.folders ?? folders,
    });
    return result;
  },

  previewImport: async (file: File) => {
    return apiUpload<ImportPreview>('/api/sessions/import/preview', file);
  },

  fetchCredentials: async (id: string) => {
    return apiGet<SessionCredentials>(`/api/sessions/${id}/credentials`);
  },

  fetchAllCredentials: async () => {
    return apiGet<SessionCredentials[]>('/api/sessions/credentials/bulk');
  },
}));
