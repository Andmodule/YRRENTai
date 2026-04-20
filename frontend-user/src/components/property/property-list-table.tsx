'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, ArrowUpDown, Building2, Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { Property } from '@/types';
import { formatPropertyLocation } from '@/lib/format/property-location';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

type SortKey = 'name' | 'address' | 'currency' | 'timezone';

interface PropertyListTableProps {
  properties: Property[];
}

function SortGlyph({
  active,
  direction,
}: {
  active: boolean;
  direction: 'asc' | 'desc';
}) {
  if (!active) {
    return <ArrowUpDown className="h-3 w-3 shrink-0 opacity-[0.35]" aria-hidden />;
  }
  return direction === 'asc' ? (
    <ArrowUp className="h-3 w-3 shrink-0 opacity-[0.55]" aria-hidden />
  ) : (
    <ArrowDown className="h-3 w-3 shrink-0 opacity-[0.55]" aria-hidden />
  );
}

export function PropertyListTable({ properties }: PropertyListTableProps) {
  const t = useTranslations('properties.list');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = properties.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.country?.toLowerCase().includes(q) ?? false) ||
        (p.city?.toLowerCase().includes(q) ?? false) ||
        p.address.toLowerCase().includes(q) ||
        p.currency.toLowerCase().includes(q) ||
        p.timezone.toLowerCase().includes(q) ||
        (p.zodomusPropertyId?.toLowerCase().includes(q) ?? false) ||
        (p.otaPlatform?.code?.toLowerCase().includes(q) ?? false) ||
        (p.channelListings?.some(
          (c) =>
            c.externalListingId.toLowerCase().includes(q) ||
            (c.otaPlatform?.code?.toLowerCase().includes(q) ?? false),
        ) ??
          false)
      );
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir;
        case 'address':
          return a.address.localeCompare(b.address, undefined, { sensitivity: 'base' }) * dir;
        case 'currency':
          return a.currency.localeCompare(b.currency) * dir;
        case 'timezone':
          return a.timezone.localeCompare(b.timezone) * dir;
        default:
          return 0;
      }
    });
  }, [properties, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function headerButton(key: SortKey, label: string, align: 'left' | 'right' = 'left') {
    const active = sortKey === key;
    return (
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn(
          'inline-flex w-full items-center gap-1 text-[11px] font-medium uppercase tracking-wide',
          align === 'right' ? 'justify-end text-right' : 'justify-start text-left',
          'text-muted-foreground/90 transition-colors hover:text-foreground/80',
        )}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span className="min-w-0 truncate">{label}</span>
        <SortGlyph active={active} direction={sortDir} />
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative w-full max-w-full sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/55"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="h-10 border-slate-200/90 bg-white pl-8 text-sm shadow-none placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-slate-300 dark:border-border/50 dark:bg-background/60 dark:placeholder:text-muted-foreground/55 dark:focus-visible:ring-border sm:h-8"
        />
      </div>

      {/* Десктоп: широкая таблица */}
      <div className="-mx-1 hidden overflow-x-auto rounded-xl border border-border/50 bg-card/40 sm:mx-0 sm:rounded-lg lg:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-muted/20">
              <th
                scope="col"
                className="w-9 px-2 py-2.5 text-left text-[10px] font-normal tabular-nums tracking-normal text-muted-foreground/45"
              >
                {t('colIndex')}
              </th>
              <th scope="col" className="px-2 py-2.5">
                {headerButton('name', t('colName'))}
              </th>
              <th scope="col" className="min-w-[180px] px-2 py-2.5">
                {headerButton('address', t('colAddress'))}
              </th>
              <th scope="col" className="w-24 px-2 py-2.5">
                {headerButton('currency', t('colCurrency'))}
              </th>
              <th scope="col" className="w-32 px-2 py-2.5">
                {headerButton('timezone', t('colTimezone'))}
              </th>
              <th scope="col" className="w-14 px-2 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground/90">
                {t('colOta')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {query.trim() ? t('noSearchResults') : '—'}
                </td>
              </tr>
            ) : (
              rows.map((property, index) => (
                <tr
                  key={property.id}
                  className="border-b border-border/35 transition-colors last:border-0 hover:bg-muted/15"
                >
                  <td className="px-2 py-3 text-[11px] font-normal tabular-nums text-muted-foreground/40">
                    {index + 1}
                  </td>
                  <td className="px-2 py-3">
                    <Link
                      href={`/properties/${property.id}`}
                      className="group inline-flex items-center gap-2 font-normal text-neutral-700 underline-offset-2 hover:text-neutral-900 hover:underline dark:text-slate-300 dark:hover:text-white"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground transition-colors group-hover:bg-muted/70 dark:bg-slate-800/60 dark:text-slate-500 dark:group-hover:text-slate-400">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 truncate">{property.name}</span>
                    </Link>
                  </td>
                  <td className="max-w-[320px] px-2 py-3 text-muted-foreground">
                    <span className="line-clamp-2">{formatPropertyLocation(property)}</span>
                  </td>
                  <td className="px-2 py-3 tabular-nums text-muted-foreground">{property.currency}</td>
                  <td className="px-2 py-3 text-muted-foreground/90">{property.timezone}</td>
                  <td className="px-2 py-3">
                    {property.channelListings && property.channelListings.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {property.channelListings.map((cl) => (
                          <span
                            key={cl.id}
                            className="inline-flex rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary"
                            title={`${cl.otaPlatform?.code ?? '?'} · ${cl.externalListingId}`}
                          >
                            <span className="capitalize">{cl.otaPlatform?.code ?? 'OTA'}</span>
                          </span>
                        ))}
                      </div>
                    ) : property.zodomusPropertyId?.trim() ? (
                      <span
                        className="inline-flex rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary"
                        title={
                          property.otaPlatform?.code
                            ? `${property.otaPlatform.code} · ${property.zodomusPropertyId}`
                            : property.zodomusPropertyId
                        }
                      >
                        <span className="capitalize">{property.otaPlatform?.code ?? 'OTA'}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Мобайл / планшет: карточки вместо горизонтального скролла таблицы */}
      <div className="flex flex-col gap-3 lg:hidden">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/90 bg-white/90 px-4 py-10 text-center text-sm text-slate-500 shadow-sm dark:border-border/60 dark:bg-muted/20 dark:text-muted-foreground">
            {query.trim() ? t('noSearchResults') : '—'}
          </div>
        ) : (
          rows.map((property) => (
            <Link
              key={property.id}
              href={`/properties/${property.id}`}
              className="block rounded-2xl border border-slate-200/80 bg-white p-4 text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-slate-100 transition-colors active:bg-slate-50 dark:border-border/80 dark:bg-card dark:text-foreground dark:ring-border/40 dark:active:bg-muted/20"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-muted/50 dark:text-muted-foreground">
                  <Building2 className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug tracking-tight text-slate-900 dark:text-foreground">{property.name}</p>
                  <p className="mt-1 text-sm text-slate-500 line-clamp-2 dark:text-muted-foreground">{formatPropertyLocation(property)}</p>
                  <div className="mt-3 space-y-1.5 text-xs text-slate-500 dark:text-muted-foreground">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="shrink-0">{t('colCurrency')}:</span>
                      <span className="font-medium text-slate-900 dark:text-foreground">{property.currency}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {property.channelListings && property.channelListings.length > 0 ? (
                      property.channelListings.map((cl) => (
                        <span
                          key={cl.id}
                          className="inline-flex rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-700 dark:bg-primary/15 dark:text-primary"
                        >
                          {cl.otaPlatform?.code ?? 'OTA'}
                        </span>
                      ))
                    ) : property.zodomusPropertyId?.trim() ? (
                      <span className="inline-flex rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-700 dark:bg-primary/15 dark:text-primary">
                        {property.otaPlatform?.code ?? 'OTA'}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 dark:text-muted-foreground/70">—</span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
