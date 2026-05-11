"use client";

import { memo, useCallback } from "react";
import { Search, X } from "lucide-react";
import { clsx } from "clsx";

interface SearchFilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  filters?: {
    label: string;
    value: string;
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
  }[];
  className?: string;
}

function SearchFilterBar({
  searchValue,
  onSearchChange,
  placeholder = "Search...",
  filters,
  className,
}: SearchFilterBarProps) {
  const handleClear = useCallback(() => {
    onSearchChange("");
  }, [onSearchChange]);

  return (
    <div className={clsx("flex flex-col sm:flex-row gap-3 items-stretch sm:items-center", className)}>
      {/* Search Input */}
      <div className="relative flex-1 min-w-0 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#388E3C]/20 focus:border-[#388E3C] transition-all placeholder:text-gray-400"
        />
        {searchValue && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filter Dropdowns */}
      {filters && filters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <select
              key={filter.label}
              value={filter.value}
              onChange={(e) => filter.onChange(e.target.value)}
              className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#388E3C]/20 focus:border-[#388E3C] transition-all cursor-pointer"
              aria-label={filter.label}
            >
              {filter.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(SearchFilterBar);
