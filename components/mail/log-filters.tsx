'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * The log filters.
 *
 * Still URL-driven — the whole point of this screen is that a filtered view can
 * be pasted into an issue — but the controls are the product's own selects
 * rather than four native dropdowns that ignore the theme and render as OS
 * widgets in dark mode.
 *
 * Applying navigates rather than submitting a form, and only non-empty values
 * are written, so the URL stays as short as the question being asked.
 */
export function LogFilters({
  eventTypes,
  addresses,
  endpoints,
  current,
}: {
  eventTypes: FilterOption[];
  addresses: FilterOption[];
  endpoints: FilterOption[];
  current: {
    type?: string;
    addressId?: string;
    endpointId?: string;
    since?: string;
  };
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(current);

  const filtered = Object.values(current).some(Boolean);

  function apply(next: typeof draft) {
    setDraft(next);

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      // `ANY` is this component's "no filter" sentinel, because an empty string
      // is not a usable value for a select item.
      if (value && value !== ANY) params.set(key, value);
    }

    const query = params.toString();
    router.push(query ? `/logs?${query}` : '/logs');
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect
        label="Event type"
        placeholder="All event types"
        value={draft.type}
        options={eventTypes}
        onChange={(type) => apply({ ...draft, type })}
      />
      <FilterSelect
        label="Address"
        placeholder="All addresses"
        value={draft.addressId}
        options={addresses}
        onChange={(addressId) => apply({ ...draft, addressId })}
      />
      <FilterSelect
        label="Endpoint"
        placeholder="All endpoints"
        value={draft.endpointId}
        options={endpoints}
        onChange={(endpointId) => apply({ ...draft, endpointId })}
      />
      <FilterSelect
        label="Time range"
        placeholder="All time"
        value={draft.since}
        options={SINCE_OPTIONS}
        onChange={(since) => apply({ ...draft, since })}
      />

      {filtered ? (
        <Button variant="ghost" size="sm" render={<Link href="/logs" />}>
          <Icon name="close" size={12} />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

const ANY = '__any__';

const SINCE_OPTIONS: FilterOption[] = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

function FilterSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string | undefined;
  options: FilterOption[];
  onChange: (value: string | undefined) => void;
}) {
  if (options.length === 0) return null;

  return (
    <Select
      value={value ?? ANY}
      onValueChange={(next) => {
        const chosen = String(next);
        onChange(chosen === ANY ? undefined : chosen);
      }}
    >
      <SelectTrigger aria-label={label} className="w-auto min-w-40">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
