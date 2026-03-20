import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Film,
  Music,
  FileType,
  Download,
  Loader2,
  AlertCircle,
  Server,
} from 'lucide-react';
import { getPreviewUrl } from '@/api/client';
import { useTabStore } from '@/store/tabStore';
import type { Tab } from '@/types/session';

interface FilePreviewProps {
  tab: Tab;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

const previewTypeIcon: Record<string, React.ReactNode> = {
  image: <Image size={14} className="text-purple-400" />,
  video: <Film size={14} className="text-blue-400" />,
  audio: <Music size={14} className="text-green-400" />,
  pdf: <FileType size={14} className="text-red-400" />,
};

const FilePreview: React.FC<FilePreviewProps> = ({ tab }) => {
  const tabs = useTabStore((s) => s.tabs);
  const connectionId = tab.connectionId!;
  const filePath = tab.meta?.filePath as string;
  const previewType = tab.meta?.previewType as string;
  const fileSize = tab.meta?.fileSize as number | undefined;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  // Find the parent SSH/telnet tab to get server info
  const parentTab = tabs.find(
    (t) => (t.type === 'ssh' || t.type === 'telnet') && t.connectionId === connectionId
  );
  const serverName = parentTab?.title || '';
  const serverHost = parentTab?.meta?.host || '';
  const serverPort = parentTab?.meta?.port;
  const serverUser = parentTab?.meta?.username || '';
  const serverLabel = useMemo(() => {
    const userHost = serverUser && serverHost
      ? `${serverUser}@${serverHost}${serverPort && serverPort !== 22 ? ':' + serverPort : ''}`
      : serverHost || '';
    if (serverName && userHost && serverName !== userHost) {
      return `${serverName} (${userHost})`;
    }
    return serverName || userHost || '';
  }, [serverName, serverHost, serverPort, serverUser]);

  useEffect(() => {
    let cancelled = false;

    const loadPreviewUrl = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const previewUrl = await getPreviewUrl(connectionId, filePath);
        if (!cancelled) {
          setUrl(previewUrl);
        }
      } catch (err) {
        if (!cancelled) {
          setUrl(null);
          setIsLoading(false);
          setError(err instanceof Error ? err.message : 'Failed to load file preview');
        }
      }
    };

    void loadPreviewUrl();

    return () => {
      cancelled = true;
    };
  }, [connectionId, filePath]);

  const handleDownload = async () => {
    try {
      const downloadUrl = url ?? await getPreviewUrl(connectionId, filePath);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filePath.split('/').pop() || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download file preview');
    }
  };

  const handleLoad = () => {
    setIsLoading(false);
    setError(null);
  };

  const handleError = () => {
    setIsLoading(false);
    setError('Failed to load file preview');
  };

  const fileName = filePath.split('/').pop() || filePath;
  const icon = previewTypeIcon[previewType] || <FileType size={14} />;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2 min-w-0">
          {serverLabel && (
            <>
              <Server size={13} className="text-[var(--accent)] flex-shrink-0" />
              <span className="text-[11px] text-[var(--accent)] font-medium flex-shrink-0 truncate max-w-[250px]" title={serverLabel}>
                {serverLabel}
              </span>
              <span className="text-[var(--text-muted)] flex-shrink-0">/</span>
            </>
          )}
          <span className="flex-shrink-0">{icon}</span>
          <span className="text-xs text-[var(--text-secondary)] truncate" title={filePath}>
            {filePath}
          </span>
          {fileSize !== undefined && (
            <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">
              {formatFileSize(fileSize)}
            </span>
          )}
          <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 uppercase">
            {previewType}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title="Download file"
          >
            <Download size={12} />
            Download
          </button>
        </div>
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-auto flex items-center justify-center relative">
        {/* Loading indicator */}
        {isLoading && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-[var(--bg-primary)]">
            <Loader2 size={24} className="text-[var(--accent)] animate-spin" />
            <span className="text-sm text-[var(--text-secondary)]">Loading {fileName}...</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center justify-center gap-3">
            <AlertCircle size={32} className="text-[var(--danger)]" />
            <span className="text-sm text-[var(--danger)]">{error}</span>
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 text-xs bg-[var(--accent)] text-[var(--accent-contrast)] rounded hover:opacity-90 transition-opacity"
            >
              Download Instead
            </button>
          </div>
        )}

        {/* Image preview */}
        {previewType === 'image' && !error && url && (
          <div className="p-4 flex items-center justify-center w-full h-full"
            style={{ background: 'repeating-conic-gradient(var(--surface-800) 0% 25%, var(--surface-900) 0% 50%) 50% / 20px 20px' }}
          >
            <img
              src={url}
              alt={fileName}
              onLoad={handleLoad}
              onError={handleError}
              className="max-w-full max-h-full object-contain rounded shadow-lg"
              style={{ display: isLoading ? 'none' : 'block' }}
            />
          </div>
        )}

        {/* Audio preview */}
        {previewType === 'audio' && !error && url && (
          <div className="flex flex-col items-center justify-center gap-6 p-8">
            <div className="w-24 h-24 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
              <Music size={40} className="text-green-400" />
            </div>
            <span className="text-sm text-[var(--text-primary)] font-medium">{fileName}</span>
            <audio
              controls
              src={url}
              onLoadedData={handleLoad}
              onError={handleError}
              className="w-full max-w-md"
              style={{ display: isLoading ? 'none' : 'block' }}
            >
              Your browser does not support audio playback.
            </audio>
          </div>
        )}

        {/* Video preview */}
        {previewType === 'video' && !error && url && (
          <div className="w-full h-full flex items-center justify-center p-4 bg-black">
            <video
              controls
              src={url}
              onLoadedData={handleLoad}
              onError={handleError}
              className="max-w-full max-h-full rounded"
              style={{ display: isLoading ? 'none' : 'block' }}
            >
              Your browser does not support video playback.
            </video>
          </div>
        )}

        {/* PDF preview */}
        {previewType === 'pdf' && !error && url && (
          <iframe
            src={url}
            title={fileName}
            onLoad={handleLoad}
            onError={handleError}
            className="w-full h-full border-0"
            style={{ display: isLoading ? 'none' : 'block' }}
          />
        )}
      </div>
    </div>
  );
};

export default FilePreview;
