'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchVoicePolicy, upsertVoicePolicy, type VoicePolicy } from '@/lib/api/voice-policy';
import { cn } from '@/lib/utils';

type SettingsSection =
  | 'automation'
  | 'escalation'
  | 'quiet_hours'
  | 'privacy'
  | 'topics'
  | 'provider'
  | 'all';

interface VoicePolicyFormProps {
  propertyId: string;
  /** Filter which section to show. Default 'all' = full form */
  section?: SettingsSection;
  className?: string;
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="mt-0.5">
        <div
          onClick={() => onChange(!checked)}
          className={cn(
            'relative h-5 w-9 rounded-full transition-colors cursor-pointer',
            checked ? 'bg-teal-600' : 'bg-slate-200',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
              checked && 'translate-x-4',
            )}
          />
        </div>
      </div>
      <div>
        <div className="text-sm font-medium text-slate-800">{label}</div>
        {description && <div className="text-xs text-slate-400 mt-0.5">{description}</div>}
      </div>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.05,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-8 w-32 rounded-lg border border-slate-200 px-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
      />
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </div>
  );
}

export function VoicePolicyForm({ propertyId, section = 'all', className }: VoicePolicyFormProps) {
  const show = (s: SettingsSection) => section === 'all' || section === s;
  const [policy, setPolicy] = useState<VoicePolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchVoicePolicy(propertyId)
      .then(setPolicy)
      .catch(() => toast.error('Не удалось загрузить настройки'))
      .finally(() => setLoading(false));
  }, [propertyId]);

  const patch = (updates: Partial<VoicePolicy>) => {
    setPolicy((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  const handleSave = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const updated = await upsertVoicePolicy(propertyId, policy);
      setPolicy(updated);
      toast.success('Настройки сохранены');
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-8 text-sm text-slate-400 text-center">Загрузка…</div>;
  }

  if (!policy) return null;

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {/* Feature flags / Automation */}
      {show('automation') && <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Автоматизация
        </h3>
        <div className="flex flex-col gap-4">
          <Toggle
            label="AI голосовой ассистент"
            description="Отвечает на входящие звонки автоматически"
            checked={policy.voiceAssistantEnabled}
            onChange={(v) => patch({ voiceAssistantEnabled: v })}
          />
          <Toggle
            label="Автоответ"
            description="Принимать звонок без ожидания"
            checked={policy.autoAnswerEnabled}
            onChange={(v) => patch({ autoAnswerEnabled: v })}
          />
          <Toggle
            label="Запись звонков"
            description="Сохранять аудио для ревью"
            checked={policy.recordCallsEnabled}
            onChange={(v) => patch({ recordCallsEnabled: v })}
          />
          <Toggle
            label="Эскалация при экстренных ситуациях"
            description="Немедленно переводить при ключевых словах экстренной помощи"
            checked={policy.emergencyEscalationEnabled}
            onChange={(v) => patch({ emergencyEscalationEnabled: v })}
          />
          <Toggle
            label="Автоэскалация жалоб"
            description="Переключать на оператора при жалобах"
            checked={policy.complaintAutoEscalate}
            onChange={(v) => patch({ complaintAutoEscalate: v })}
          />
          <Toggle
            label="Короткие ответы"
            description="Принудительно ограничивать ответы AI до 1-2 предложений"
            checked={policy.shortAnswerMode}
            onChange={(v) => patch({ shortAnswerMode: v })}
          />
        </div>
      </section>}

      {/* Thresholds / Escalation */}
      {show('escalation') && <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Пороги и эскалация
        </h3>
        <div className="flex flex-wrap gap-4">
          <NumberField
            label="Порог уточнения"
            value={policy.clarifyThreshold}
            onChange={(v) => patch({ clarifyThreshold: v })}
            min={0}
            max={1}
            hint="Ниже — AI переспрашивает"
          />
          <NumberField
            label="Порог эскалации"
            value={policy.escalateThreshold}
            onChange={(v) => patch({ escalateThreshold: v })}
            min={0}
            max={1}
            hint="Ниже — передаёт оператору"
          />
          <NumberField
            label="Макс. реплик"
            value={policy.maxTurns}
            onChange={(v) => patch({ maxTurns: Math.round(v) })}
            min={1}
            max={50}
            step={1}
            hint="После этого — handoff"
          />
        </div>
      </section>}

      {/* Hours */}
      {show('quiet_hours') && <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Тихие часы
        </h3>
        <div className="flex flex-wrap gap-4 items-end">
          <NumberField
            label="Начало (ч)"
            value={policy.quietHoursStart}
            onChange={(v) => patch({ quietHoursStart: Math.round(v) })}
            min={0}
            max={23}
            step={1}
          />
          <NumberField
            label="Конец (ч)"
            value={policy.quietHoursEnd}
            onChange={(v) => patch({ quietHoursEnd: Math.round(v) })}
            min={0}
            max={23}
            step={1}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Режим вне часов</label>
            <select
              value={policy.afterHoursMode}
              onChange={(e) => patch({ afterHoursMode: e.target.value as VoicePolicy['afterHoursMode'] })}
              className="h-8 rounded-lg border border-slate-200 px-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="short_ai">Короткий AI</option>
              <option value="transfer">Перевод</option>
              <option value="voicemail">Голосовое сообщение</option>
              <option value="reject">Отклонить</option>
            </select>
          </div>
        </div>
      </section>}

      {/* Routing / Provider */}
      {show('provider') && <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Провайдер и маршрутизация
        </h3>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Номер для перевода (E.164)</label>
            <Input
              value={policy.fallbackTransferNumber ?? ''}
              onChange={(e) => patch({ fallbackTransferNumber: e.target.value || null })}
              placeholder="+79991234567"
              className="w-56 h-8 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Языки ответов (через запятую)</label>
            <Input
              value={policy.preferredLanguages}
              onChange={(e) => patch({ preferredLanguages: e.target.value })}
              placeholder="ru,en"
              className="w-56 h-8 text-sm"
            />
          </div>
        </div>
      </section>}

      {/* Topics */}
      {show('topics') && <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Темы и ограничения
        </h3>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Разрешённые темы (через запятую)</label>
            <Input
              value={policy.allowedTopics ?? ''}
              onChange={(e) => patch({ allowedTopics: e.target.value || null })}
              placeholder="checkin,wifi,parking,deposit"
              className="h-8 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Темы-триггеры эскалации (через запятую)</label>
            <Input
              value={policy.escalationTopics ?? ''}
              onChange={(e) => patch({ escalationTopics: e.target.value || null })}
              placeholder="legal,refund,complaint"
              className="h-8 text-sm"
            />
          </div>
        </div>
      </section>}

      {/* Privacy */}
      {show('privacy') && <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Приватность и хранение данных
        </h3>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Срок хранения транскриптов (дней, 0 = бессрочно)</label>
            <input
              type="number"
              min={0}
              max={365}
              step={1}
              value={policy.transcriptRetentionDays ?? 90}
              onChange={(e) => patch({ transcriptRetentionDays: parseInt(e.target.value, 10) })}
              className="h-8 w-32 rounded-lg border border-slate-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <Toggle
            label="Редактирование PII"
            description="Маскировать телефоны, email и имена в сохранённых транскриптах"
            checked={policy.redactionEnabled ?? false}
            onChange={(v) => patch({ redactionEnabled: v })}
          />
          <Toggle
            label="Разрешить экспорт транскриптов"
            description="Оператор может скачать транскрипт через API"
            checked={policy.exportAllowed ?? true}
            onChange={(v) => patch({ exportAllowed: v })}
          />
          <Toggle
            label="Хранить аудиозаписи"
            description="Сохранять аудио на стороне провайдера"
            checked={policy.recordingStorageEnabled ?? false}
            onChange={(v) => patch({ recordingStorageEnabled: v })}
          />
        </div>
      </section>}

      <div className="flex gap-3 pt-2 border-t border-slate-100">
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить настройки'}
        </Button>
        <span className="text-xs text-slate-400 self-center">
          Обновлено: {new Date(policy.updatedAt).toLocaleString('ru-RU')}
        </span>
      </div>
    </div>
  );
}
