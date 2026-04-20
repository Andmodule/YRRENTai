'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { VoicePolicyForm } from '@/components/calls/settings/VoicePolicyForm';
import { usePropertyRollout } from '@/hooks/use-calls-stats';
import { fetchVoicePolicy, saveVoicePolicy } from '@/lib/api/voice-policy';
import { buildExportUrl } from '@/lib/api/calls-stats';
import { cn } from '@/lib/utils';
import {
  Bot, Zap, Moon, Shield, Tags, Server, BarChart3, AlertTriangle, Download,
} from 'lucide-react';
import type { PropertyRolloutItem } from '@/lib/api/calls-stats';

type SettingsSection =
  | 'automation'
  | 'escalation'
  | 'quiet_hours'
  | 'privacy'
  | 'topics'
  | 'provider'
  | 'rollout';

const SECTIONS: Array<{ key: SettingsSection; label: string; icon: typeof Bot; description: string }> = [
  { key: 'automation',   label: 'Автоматизация',    icon: Bot,      description: 'Voice AI, автоответ, лимит реплик' },
  { key: 'escalation',   label: 'Эскалация',        icon: Zap,      description: 'Пороги, экстренная маршрутизация' },
  { key: 'quiet_hours',  label: 'Тихие часы',       icon: Moon,     description: 'Расписание и режим нерабочего времени' },
  { key: 'privacy',      label: 'Приватность',      icon: Shield,   description: 'Хранение, редактирование, экспорт' },
  { key: 'topics',       label: 'Темы',             icon: Tags,     description: 'Разрешённые темы и топики эскалации' },
  { key: 'provider',     label: 'Провайдер',        icon: Server,   description: 'Retell / Vapi, номер трансфера' },
  { key: 'rollout',      label: 'Rollout',          icon: BarChart3, description: 'Статус по всем объектам' },
];

export default function CallsSettingsPage() {
  const searchParams = useSearchParams();
  const initialProperty = searchParams.get('propertyId') ?? '';
  const [section, setSection] = useState<SettingsSection>('automation');
  const [propertyId, setPropertyId] = useState(initialProperty);
  const { data: rollout = [] } = usePropertyRollout();

  const propertyIds = [...new Set(rollout.map((r) => r.propertyId))];

  return (
    <div className="flex flex-col h-full">
      {/* Subheader */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-200 bg-white shrink-0">
        <Server className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-slate-700">Настройки Voice AI</span>
        {propertyIds.length > 0 && (
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="ml-auto h-7 rounded-lg border border-slate-200 px-2 text-xs text-slate-700 focus:outline-none"
          >
            <option value="">Выберите объект…</option>
            {rollout.map((r) => (
              <option key={r.propertyId} value={r.propertyId}>
                {r.propertyName ?? r.propertyId.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Section sidebar */}
        <nav className="w-52 shrink-0 bg-white border-r border-slate-200 p-2 flex flex-col gap-0.5">
          {SECTIONS.map(({ key, label, icon: Icon, description }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={cn(
                'flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
                section === key
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              <Icon className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold leading-none">{label}</div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">{description}</div>
              </div>
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-5">
          {section === 'rollout' ? (
            <RolloutSection rollout={rollout} />
          ) : !propertyId ? (
            <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
              Сначала выберите объект в шапке
            </div>
          ) : (
            <VoicePolicyForm
              propertyId={propertyId}
              section={section}
              className="max-w-2xl"
            />
          )}
        </main>
      </div>
    </div>
  );
}

function RolloutSection({ rollout }: { rollout: PropertyRolloutItem[] | undefined }) {
  const items = rollout ?? [];
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: ({ propertyId, patch }: { propertyId: string; patch: Record<string, unknown> }) =>
      saveVoicePolicy(propertyId, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['property-rollout'] });
      toast.success('Политика обновлена');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Rollout по объектам</h2>
        <a
          href={buildExportUrl('history', {})}
          download
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-teal-600"
        >
          <Download className="h-3 w-3" /> Экспорт истории
        </a>
      </div>

      <div className="rounded-2xl ring-1 ring-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Объект</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">AI</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Провайдер</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">7d</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Fallback</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Экспорт</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {items.map((item) => (
              <RolloutRow
                key={item.propertyId}
                item={item}
                isSaving={saveMutation.isPending}
                onToggle={(enabled) => saveMutation.mutate({ propertyId: item.propertyId, patch: { voiceAssistantEnabled: enabled } })}
                onProviderChange={(provider) => saveMutation.mutate({ propertyId: item.propertyId, patch: { provider } })}
              />
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-400">Политики не настроены</div>
        )}
      </div>
    </div>
  );
}

function RolloutRow({
  item, isSaving, onToggle, onProviderChange,
}: {
  item: PropertyRolloutItem;
  isSaving: boolean;
  onToggle: (enabled: boolean) => void;
  onProviderChange: (provider: string) => void;
}) {
  const hasIssue = item.lastIssue !== null;
  const exportBlocked = false; // resolved from policy via API; placeholder

  return (
    <tr className={cn('hover:bg-slate-50', hasIssue && 'bg-amber-50/40')}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {hasIssue && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
          <span className="font-medium text-slate-700 text-sm truncate max-w-[160px]">
            {item.propertyName ?? item.propertyId.slice(0, 8)}
          </span>
        </div>
      </td>

      <td className="px-3 py-3 text-center">
        <button
          onClick={() => onToggle(!item.enabled)}
          disabled={isSaving}
          className={cn(
            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-60',
            item.enabled ? 'bg-teal-500' : 'bg-slate-200',
          )}
        >
          <span className={cn(
            'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
            item.enabled ? 'translate-x-4' : 'translate-x-1',
          )} />
        </button>
      </td>

      <td className="px-3 py-3 text-center">
        <select
          value={item.provider}
          disabled={isSaving}
          onChange={(e) => onProviderChange(e.target.value)}
          className="h-6 rounded-md border border-slate-200 px-1.5 text-xs text-slate-600 focus:outline-none disabled:opacity-60"
        >
          <option value="retell">Retell</option>
          <option value="vapi">Vapi</option>
          <option value="twilio">Twilio</option>
        </select>
      </td>

      <td className="px-3 py-3 text-center text-xs text-slate-600">{item.callsLast7d}</td>

      <td className="px-3 py-3 text-center text-xs">
        {item.fallbackRate !== null ? (
          <span className={cn(
            'font-semibold tabular-nums',
            item.fallbackRate > 20 ? 'text-red-500' :
            item.fallbackRate > 10 ? 'text-amber-500' : 'text-teal-600',
          )}>
            {item.fallbackRate}%
          </span>
        ) : <span className="text-slate-300">—</span>}
      </td>

      <td className="px-3 py-3 text-center">
        {exportBlocked ? (
          <span className="flex items-center justify-center gap-1 text-[10px] text-amber-600">
            <AlertTriangle className="h-3 w-3" /> Запрещён
          </span>
        ) : (
          <span className="text-[10px] text-teal-600">✓ Разрешён</span>
        )}
      </td>
    </tr>
  );
}
