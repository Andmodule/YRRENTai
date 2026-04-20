'use client';

import { useState } from 'react';
import { usePropertyRollout, useVoiceReadiness } from '@/hooks/use-calls-admin';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Bot, Zap, Shield, Server, BarChart3, AlertTriangle, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import type { PropertyRolloutItem, GoLiveReadiness } from '@/lib/api/calls-admin';

const SECTIONS = [
  { key: 'rollout',  label: 'Rollout',      icon: BarChart3, description: 'Статус и включение по объектам' },
  { key: 'automation', label: 'Автоматизация', icon: Bot,     description: 'Voice AI, автоответ, лимит реплик' },
  { key: 'escalation', label: 'Эскалация',    icon: Zap,     description: 'Пороги и экстренная маршрутизация' },
  { key: 'privacy',    label: 'Приватность',   icon: Shield,  description: 'Хранение и редактирование данных' },
  { key: 'provider',   label: 'Провайдер',     icon: Server,  description: 'Retell / Vapi, номер трансфера' },
] as const;
type Section = (typeof SECTIONS)[number]['key'];

export default function CallsSettingsPage() {
  const [section, setSection] = useState<Section>('rollout');
  const { data: rollout = [] }    = usePropertyRollout();
  const { data: readiness }       = useVoiceReadiness();

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-col sm:flex-row min-h-[60vh] rounded-xl border border-slate-700 overflow-hidden bg-slate-900">
        {/* Sidebar */}
        <nav className="flex flex-row sm:flex-col gap-0.5 p-2 border-b sm:border-b-0 sm:border-r border-slate-700 shrink-0 sm:w-52 overflow-x-auto sm:overflow-x-visible">
          {SECTIONS.map(({ key, label, icon: Icon, description }) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={cn(
                'flex items-start gap-2 rounded-xl px-3 py-2.5 text-left transition-colors shrink-0',
                section === key ? 'bg-cyan-500/10 text-cyan-300' : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200',
              )}
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="hidden sm:block">
                <div className="text-xs font-semibold leading-none">{label}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{description}</div>
              </div>
              <span className="sm:hidden text-xs font-medium">{label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 p-5 overflow-y-auto">
          {section === 'rollout'   && <RolloutSection items={rollout} />}
          {section === 'provider'  && <ProviderSection readiness={readiness} />}
          {section !== 'rollout' && section !== 'provider' && (
            <div className="flex flex-col gap-2 text-slate-400 items-center justify-center h-40">
              <p className="text-sm">Выберите объект и откройте настройки политики</p>
              <p className="text-xs text-slate-500">Детальные настройки голосового AI редактируются через API или форму политики</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Rollout section ───────────────────────────────────────────────────────────

function RolloutSection({ items }: { items: PropertyRolloutItem[] }) {
  const [saving, setSaving] = useState<string | null>(null);

  async function toggleEnabled(propertyId: string, enabled: boolean) {
    setSaving(propertyId);
    try {
      await apiClient.put(`/voice/policy/${propertyId}`, { voiceAssistantEnabled: enabled });
      toast.success('Сохранено');
    } catch {
      toast.error('Ошибка');
    } finally {
      setSaving(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-500">
        <BarChart3 className="h-8 w-8 opacity-20" />
        <p className="text-sm">Политики не настроены. Добавьте объект.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
        Voice AI по объектам
      </h2>
      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/60">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase text-slate-500">Объект</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase text-slate-500">AI</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase text-slate-500">Провайдер</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase text-slate-500">7d звонков</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-semibold uppercase text-slate-500">Fallback</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {items.map((item) => (
              <tr key={item.propertyId} className="hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {item.lastIssue && <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                    <span className="font-medium text-slate-200 truncate max-w-[140px]">
                      {item.propertyName ?? item.propertyId.slice(0, 8)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3 text-center">
                  <button
                    disabled={saving === item.propertyId}
                    onClick={() => void toggleEnabled(item.propertyId, !item.enabled)}
                    className={cn(
                      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-60',
                      item.enabled ? 'bg-teal-500' : 'bg-slate-600',
                    )}
                  >
                    <span className={cn(
                      'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                      item.enabled ? 'translate-x-4' : 'translate-x-1',
                    )} />
                  </button>
                </td>
                <td className="px-3 py-3 text-center text-xs text-slate-400">{item.provider}</td>
                <td className="px-3 py-3 text-center text-xs text-slate-300">{item.callsLast7d}</td>
                <td className="px-3 py-3 text-center text-xs">
                  {item.fallbackRate !== null ? (
                    <span className={cn('font-semibold',
                      item.fallbackRate > 20 ? 'text-red-400' :
                      item.fallbackRate > 10 ? 'text-amber-400' : 'text-teal-400')}>
                      {item.fallbackRate}%
                    </span>
                  ) : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Provider section ──────────────────────────────────────────────────────────

type FieldStatus = 'ok' | 'warn' | 'missing';

function FieldRow({
  label, value, status, hint,
}: { label: string; value: string; status: FieldStatus; hint?: string }) {
  const Icon = status === 'ok' ? CheckCircle2 : status === 'warn' ? AlertTriangle : XCircle;
  const col  = { ok: 'text-teal-400', warn: 'text-amber-400', missing: 'text-red-400' }[status];
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-700/40 last:border-0">
      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', col)} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-300">{label}</p>
        {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <span className={cn('text-xs font-mono shrink-0 max-w-[180px] truncate', status === 'ok' ? 'text-slate-300' : col)}>
        {value}
      </span>
    </div>
  );
}

function ProviderSection({ readiness }: { readiness?: GoLiveReadiness }) {
  if (!readiness) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
        Загрузка readiness данных…
      </div>
    );
  }

  const { env, provider, webhook, handoff } = readiness;
  const checkMap = new Map(readiness.checks.map((c) => [c.key, c]));

  const apiKeyCheck     = checkMap.get('env_provider_api_key');
  const secretCheck     = checkMap.get('env_webhook_secret');
  const agentIdCheck    = checkMap.get('env_retell_agent_id');
  const inboundNumCheck = checkMap.get('env_retell_inbound_number');
  const didMapCheck     = checkMap.get('env_did_map');
  const handoffCheck    = checkMap.get('handoff_transfer_number');
  const publicUrlCheck  = checkMap.get('env_public_backend_url');

  const toFieldStatus = (s?: string): FieldStatus =>
    s === 'pass' ? 'ok' : s === 'warn' ? 'warn' : 'missing';

  // Build webhook URLs from checks
  const baseUrl = publicUrlCheck?.message.includes('Public URL:')
    ? publicUrlCheck.message.replace('Public URL: ', '').trim()
    : '';
  const inboundWebhookUrl  = baseUrl ? `${baseUrl}/api/v1/voice/retell/inbound`  : 'Set PUBLIC_BACKEND_URL';
  const eventWebhookUrl    = baseUrl ? `${baseUrl}/api/v1/voice/retell/webhook`   : 'Set PUBLIC_BACKEND_URL';

  return (
    <div className="space-y-5">
      {/* Provider identity */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Провайдер</h2>
        <div className="rounded-xl border border-slate-700 overflow-hidden bg-slate-800/30 px-4">
          <FieldRow
            label="Provider"
            value={env.provider.toUpperCase()}
            status="ok"
          />
          <FieldRow
            label="Voice AI включен"
            value={env.voiceFeatureFlagEnabled ? 'Да' : 'Нет (FF_VOICE_ENABLED=false)'}
            status={env.voiceFeatureFlagEnabled ? 'ok' : 'warn'}
          />
          <FieldRow
            label="Inbound enabled"
            value={provider.inboundEnabled ? 'Да' : 'Нет'}
            status={provider.inboundEnabled ? 'ok' : 'warn'}
          />
        </div>
      </div>

      {/* Retell credentials */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Retell Credentials</h2>
        <div className="rounded-xl border border-slate-700 overflow-hidden bg-slate-800/30 px-4">
          <FieldRow
            label="RETELL_API_KEY"
            value={apiKeyCheck?.status === 'pass' ? '••••••••' : 'Не задан'}
            status={toFieldStatus(apiKeyCheck?.status)}
            hint={apiKeyCheck?.message}
          />
          <FieldRow
            label="RETELL_WEBHOOK_SECRET"
            value={secretCheck?.status === 'pass' ? '••••••••' : 'Не задан'}
            status={toFieldStatus(secretCheck?.status)}
            hint={secretCheck?.status !== 'pass' ? 'Подпись webhook не верифицируется' : undefined}
          />
          <FieldRow
            label="RETELL_AGENT_ID"
            value={agentIdCheck?.status === 'pass' ? 'Задан' : 'Не задан'}
            status={toFieldStatus(agentIdCheck?.status)}
            hint={agentIdCheck?.status !== 'pass' ? 'Скопируйте из Retell Dashboard → Agents' : undefined}
          />
        </div>
      </div>

      {/* Phone numbers */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Телефонные номера</h2>
        <div className="rounded-xl border border-slate-700 overflow-hidden bg-slate-800/30 px-4">
          <FieldRow
            label="Входящий номер (Retell)"
            value={inboundNumCheck?.message.includes(':') ? inboundNumCheck.message.split(':').slice(1).join(':').trim() : 'Не задан'}
            status={toFieldStatus(inboundNumCheck?.status)}
            hint="RETELL_INBOUND_NUMBER в .env"
          />
          <FieldRow
            label="Transfer number (handoff)"
            value={handoff.transferNumberPresent ? 'Задан' : 'Не задан'}
            status={handoff.transferNumberPresent ? 'ok' : 'warn'}
            hint="HANDOFF_TRANSFER_NUMBER"
          />
          <FieldRow
            label="DID → Property map"
            value={didMapCheck?.message ?? 'Не задан'}
            status={toFieldStatus(didMapCheck?.status)}
            hint="INBOUND_DID_PROPERTY_MAP=+7999…:uuid,…"
          />
        </div>
      </div>

      {/* Webhook URLs */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Webhook URLs</h2>
        <p className="text-xs text-slate-400 mb-3">
          Скопируйте в Retell Dashboard. Inbound URL — на номер телефона. Event URL — в настройки аккаунта (General webhook).
        </p>
        <div className="rounded-xl border border-slate-700 overflow-hidden bg-slate-800/30 divide-y divide-slate-700/40">
          {[
            { label: 'Inbound webhook (на номер)', url: inboundWebhookUrl },
            { label: 'Event webhook (General)',     url: eventWebhookUrl },
          ].map(({ label, url }) => (
            <div key={label} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-300">{label}</p>
                <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">{url}</p>
              </div>
              {baseUrl && (
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="p-1 rounded text-slate-500 hover:text-slate-300 shrink-0">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          Webhook signature: <span className={cn('font-semibold', webhook.signingSecretPresent ? 'text-teal-400' : 'text-amber-400')}>
            {webhook.signingSecretPresent ? 'верифицируется' : 'отключена (RETELL_WEBHOOK_SECRET не задан)'}
          </span>
        </p>
      </div>
    </div>
  );
}
