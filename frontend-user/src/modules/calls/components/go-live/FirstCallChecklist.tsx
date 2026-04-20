'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, XCircle, AlertTriangle,
  Radio, ArrowRight, ExternalLink,
} from 'lucide-react';
import type { GoLiveReadiness } from '@/lib/api/calls-admin';

// ── Types ─────────────────────────────────────────────────────────────────────

type ItemStatus = 'ok' | 'warn' | 'missing';

interface ChecklistItem {
  key: string;
  label: string;
  status: ItemStatus;
  hint?: string;
  link?: string;
  external?: boolean;
}

// ── Item row ──────────────────────────────────────────────────────────────────

function CheckItem({ item }: { item: ChecklistItem }) {
  const Icon = item.status === 'ok'
    ? CheckCircle2
    : item.status === 'warn'
      ? AlertTriangle
      : XCircle;
  const iconColor = {
    ok:      'text-teal-400',
    warn:    'text-amber-400',
    missing: 'text-red-400',
  }[item.status];

  const content = (
    <div className={cn(
      'flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors',
      item.status === 'ok'
        ? 'border-teal-700/20 bg-teal-950/15'
        : item.status === 'warn'
          ? 'border-amber-700/20 bg-amber-950/15 hover:bg-amber-950/25'
          : 'border-red-700/20 bg-red-950/15 hover:bg-red-950/25',
    )}>
      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', iconColor)} />
      <div className="flex-1 min-w-0">
        <p className={cn('text-xs font-medium', item.status === 'ok' ? 'text-muted-foreground dark:text-slate-300' : 'text-foreground dark:text-slate-200')}>
          {item.label}
        </p>
        {item.hint && (
          <p className="mt-0.5 text-[10px] text-muted-foreground dark:text-slate-500">{item.hint}</p>
        )}
      </div>
      {item.link && (
        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-slate-600" />
      )}
    </div>
  );

  if (item.link) {
    if (item.external) {
      return (
        <a href={item.link} target="_blank" rel="noopener noreferrer">
          {content}
        </a>
      );
    }
    return <Link href={item.link}>{content}</Link>;
  }
  return content;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  readiness: GoLiveReadiness;
}

export function FirstCallChecklist({ readiness }: Props) {
  const params = useParams();
  const locale = (params?.locale as string) ?? 'ru';
  const base   = `/${locale}/dashboard/calls`;

  const checkMap = new Map(readiness.checks.map((c) => [c.key, c]));
  const cfg = readiness;

  const toStatus = (present: boolean, required = true): ItemStatus =>
    present ? 'ok' : required ? 'missing' : 'warn';

  // Build retell webhook URLs from readiness data
  const publicUrlCheck  = checkMap.get('env_public_backend_url');
  const baseUrl         = publicUrlCheck?.message.includes('Public URL:')
    ? publicUrlCheck.message.replace('Public URL: ', '').trim()
    : null;
  const inboundUrl      = baseUrl ? `${baseUrl}/api/v1/voice/retell/inbound`  : null;
  const eventUrl        = baseUrl ? `${baseUrl}/api/v1/voice/retell/webhook`  : null;

  const items: ChecklistItem[] = [
    // 1. Retell API key
    {
      key:    'api_key',
      label:  'Retell API key настроен',
      status: toStatus(cfg.env.requiredKeysPresent),
      hint:   cfg.env.requiredKeysPresent ? 'RETELL_API_KEY в .env' : 'Задайте RETELL_API_KEY',
    },
    // 2. Retell Agent ID
    {
      key:    'agent_id',
      label:  'Retell Agent ID присутствует',
      status: toStatus(checkMap.get('env_retell_agent_id')?.status === 'pass', false),
      hint:   'RETELL_AGENT_ID — скопируйте из Retell Dashboard',
    },
    // 3. Inbound webhook URL
    {
      key:     'inbound_url',
      label:   'Inbound webhook URL',
      status:  inboundUrl ? 'ok' : 'warn',
      hint:    inboundUrl ?? 'Задайте PUBLIC_BACKEND_URL для отображения URL',
      link:    inboundUrl ?? undefined,
      external: !!inboundUrl,
    },
    // 4. Event webhook URL
    {
      key:     'event_url',
      label:   'Event webhook URL',
      status:  eventUrl ? 'ok' : 'warn',
      hint:    eventUrl ?? 'Задайте PUBLIC_BACKEND_URL для отображения URL',
      link:    eventUrl ?? undefined,
      external: !!eventUrl,
    },
    // 5. Transfer number
    {
      key:    'transfer_number',
      label:  'Transfer number для handoff',
      status: toStatus(cfg.handoff.transferNumberPresent, false),
      hint:   cfg.handoff.transferNumberPresent ? 'HANDOFF_TRANSFER_NUMBER задан' : 'Задайте HANDOFF_TRANSFER_NUMBER (E.164)',
    },
    // 6. DID map
    {
      key:    'did_map',
      label:  'DID → Property mapping',
      status: toStatus(cfg.handoff.didMapPresent),
      hint:   cfg.handoff.didMapPresent ? 'INBOUND_DID_PROPERTY_MAP задан' : 'Задайте INBOUND_DID_PROPERTY_MAP',
    },
    // 7. Pilot property enabled
    {
      key:    'pilot_enabled',
      label:  'Pilot объект включён',
      status: cfg.rollout.enabledPropertiesCount > 0 ? 'ok' : 'missing',
      hint:   cfg.rollout.enabledPropertiesCount > 0
        ? `${cfg.rollout.enabledPropertiesCount} объект(ов) включены`
        : 'Включите как минимум один pilot объект',
      link:   `${base}/rollout`,
    },
    // 8. Alert rules
    {
      key:    'alert_rules',
      label:  'Alert rules для мониторинга',
      status: cfg.alerts.activeRuleCount > 0 ? 'ok' : 'warn',
      hint:   cfg.alerts.activeRuleCount > 0
        ? `${cfg.alerts.activeRuleCount} правил активны`
        : 'Создайте alert rules или запустите bootstrap',
      link:   `${base}/overview`,
    },
    // 9. Live page open
    {
      key:    'live_page',
      label:  'Live консоль открыта',
      status: 'warn',
      hint:   'Откройте Live перед первым звонком для наблюдения',
      link:   `${base}/live`,
    },
    // 10. Rollback path
    {
      key:    'rollback',
      label:  'Rollback: можно отключить pilot',
      status: 'ok',
      hint:   'Rollout → выберите объект → disable',
      link:   `${base}/rollout`,
    },
  ];

  const okCount      = items.filter((i) => i.status === 'ok').length;
  const missingCount = items.filter((i) => i.status === 'missing').length;
  const warnCount    = items.filter((i) => i.status === 'warn').length;

  const ready = missingCount === 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/90 dark:border-slate-700/50 dark:bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-4 py-3 dark:border-slate-700/40 dark:bg-slate-800/40">
        <div className="flex items-center gap-2">
          <Radio className={cn('h-4 w-4', ready ? 'text-teal-400' : 'text-amber-400')} />
          <span className="text-sm font-semibold text-foreground dark:text-slate-200">First Real Call Checklist</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground dark:text-slate-400">
          <span className="text-teal-400 font-semibold">{okCount}</span>
          {warnCount > 0 && <><span>/</span><span className="font-semibold text-amber-600 dark:text-amber-400">{warnCount}</span><span className="text-muted-foreground dark:text-slate-500">warn</span></>}
          {missingCount > 0 && <><span>/</span><span className="font-semibold text-red-600 dark:text-red-400">{missingCount}</span><span className="text-muted-foreground dark:text-slate-500">missing</span></>}
        </div>
      </div>

      <div className="p-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {items.map((item) => (
          <CheckItem key={item.key} item={item} />
        ))}
      </div>

      {/* CTA if ready */}
      {ready && (
        <div className="px-4 py-3 border-t border-teal-700/30 bg-teal-950/20 flex items-center justify-between">
          <p className="text-xs text-teal-300 font-medium">Все критичные пункты выполнены — можно принять первый звонок</p>
          <Link href={`${base}/live`}
            className="flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 font-medium shrink-0">
            Live <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}
