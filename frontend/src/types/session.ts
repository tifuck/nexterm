export type SessionType = 'ssh' | 'rdp' | 'vnc' | 'telnet' | 'ftp' | 'sftp';

export interface Session {
  id: string;
  name: string;
  session_type: SessionType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  ssh_key?: string;
  folder_id?: string;
  color?: string;
  icon?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  last_connected?: string;
}

export interface Folder {
  id: string;
  name: string;
  parent_id?: string | null;
  color?: string | null;
  icon?: string;
  sort_order: number;
  children?: Folder[];
  sessions?: Session[];
}

export interface Tab {
  id: string;
  type: 'home' | SessionType | 'editor' | 'preview' | 'settings';
  title: string;
  sessionId?: string;
  connectionId?: string;
  isConnected: boolean;
  closedAt?: number;
  meta?: Record<string, any>;
}
