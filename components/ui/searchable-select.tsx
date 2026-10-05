'use client';

import { Combobox } from '@base-ui/react/combobox';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons';

import { cn } from 'cn';

export interface SearchableOption {
  value: string;
  label: string;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  label,
  placeholder,
  searchPlaceholder,
  id,
  className,
}: {
  options: SearchableOption[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  id?: string;
  className?: string;
}) {
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <Combobox.Root
      items={options}
      value={selected}
      onValueChange={(option) => {
        if (option) onValueChange(option.value);
      }}
    >
      <Combobox.Trigger
        id={id}
        aria-label={label}
        className={cn(
          'flex h-7 w-fit items-center justify-between gap-1.5 rounded-md border border-input bg-input/20 px-2 py-1.5 text-xs/relaxed outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30 dark:hover:bg-input/50',
          className,
        )}
      >
        <Combobox.Value placeholder={placeholder ?? label} />
        <Combobox.Icon className="text-muted-foreground">
          <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={2} className="size-3.5" />
        </Combobox.Icon>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner side="bottom" sideOffset={6} align="start" className="isolate z-50">
          <Combobox.Popup
            aria-label={label}
            className="relative isolate z-50 min-w-(--anchor-width) max-w-[min(90vw,28rem)] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            <Combobox.Input
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`}
              className="mb-1 h-8 w-full rounded-md border border-input bg-input/20 px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <Combobox.Empty className="px-2 py-2 text-xs text-muted-foreground">
              No matches found.
            </Combobox.Empty>
            <Combobox.List className="max-h-60 overflow-y-auto">
              {(option: SearchableOption) => (
                <Combobox.Item
                  key={option.value}
                  value={option}
                  className="relative flex min-h-7 cursor-default items-center rounded-md px-2 pr-7 text-xs/relaxed outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="truncate">{option.label}</span>
                  <Combobox.ItemIndicator className="absolute right-2">
                    <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-3.5" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
