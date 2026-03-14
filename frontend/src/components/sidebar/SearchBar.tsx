import React, { useCallback, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { useSidebarStore } from '@/store/sidebarStore';

interface SearchBarProps {
  placeholder?: string;
  autoFocus?: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = 'Search sessions...',
  autoFocus = false,
}) => {
  const { searchQuery, setSearchQuery } = useSidebarStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [setSearchQuery]
  );

  const handleClear = useCallback(() => {
    setSearchQuery('');
    inputRef.current?.focus();
  }, [setSearchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('');
        } else {
          inputRef.current?.blur();
        }
      }
    },
    [searchQuery, setSearchQuery]
  );

  return (
    <div className="relative group">
      <div className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none">
        <Search
          size={13}
          className="text-[var(--text-muted)] group-focus-within:text-[var(--accent)] transition-colors"
        />
      </div>
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`
          w-full h-8 pl-8 pr-8 text-xs
          bg-[var(--bg-input)] text-[var(--text-primary)]
          placeholder-[var(--text-muted)]
          border border-[var(--border-primary)]
          rounded-md outline-none
          transition-all duration-150
          focus:border-[var(--border-focus)]
          focus:ring-1 focus:ring-[var(--accent)]
          focus:ring-opacity-30
        `}
      />
      {searchQuery && (
        <button
          onClick={handleClear}
          className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};

export default SearchBar;
