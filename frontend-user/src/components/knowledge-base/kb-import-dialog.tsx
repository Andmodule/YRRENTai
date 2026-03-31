'use client';

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Upload, Link2, CheckSquare, Square, Loader2, FileText } from 'lucide-react';
import {
  ResponsiveModal,
  ResponsiveModalTrigger,
  ResponsiveModalContent,
  ResponsiveModalClose,
} from '@/components/ui/responsive-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KbCategoryBadge } from './kb-category-badge';
import { apiClient } from '@/lib/api/client';

interface Draft {
  id: string;
  title: string;
  content: string;
  category: string;
}

interface ImportResponse {
  data: {
    drafts: Draft[];
    total: number;
  };
}

interface ConfirmResponse {
  data: { saved: number };
}

type ImportMode = 'idle' | 'file' | 'url';
type ImportStep = 'input' | 'preview' | 'done';

interface KbImportDialogProps {
  propertyId: string;
  onConfirmed: () => void;
}

export function KbImportDialog({ propertyId, onConfirmed }: KbImportDialogProps) {
  const t = useTranslations('kb.import');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>('idle');
  const [step, setStep] = useState<ImportStep>('input');
  const [url, setUrl] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleClose() {
    setOpen(false);
    setTimeout(() => {
      setMode('idle');
      setStep('input');
      setUrl('');
      setDrafts([]);
      setSelectedIds(new Set());
    }, 200);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<ImportResponse>(
        `/knowledge-base/${propertyId}/import/file`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      openPreview(res.data.data.drafts);
    } catch {
      toast.error(t('errorParse'));
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleUrlImport() {
    if (!url.trim()) return;
    setIsProcessing(true);
    try {
      const res = await apiClient.post<ImportResponse>(
        `/knowledge-base/${propertyId}/import/url`,
        { url },
      );
      openPreview(res.data.data.drafts);
    } catch {
      toast.error(t('errorParse'));
    } finally {
      setIsProcessing(false);
    }
  }

  function openPreview(items: Draft[]) {
    setDrafts(items);
    setSelectedIds(new Set(items.map((d) => d.id)));
    setStep('preview');
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === drafts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(drafts.map((d) => d.id)));
    }
  }

  async function handleConfirm() {
    const selected = drafts.filter((d) => selectedIds.has(d.id));
    if (selected.length === 0) return;
    setIsProcessing(true);
    try {
      const res = await apiClient.post<ConfirmResponse>(
        `/knowledge-base/${propertyId}/import/confirm`,
        { drafts: selected },
      );
      toast.success(t('confirmSuccess', { count: res.data.data.saved }));
      onConfirmed();
      handleClose();
    } catch {
      toast.error(t('errorConfirm'));
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <ResponsiveModal open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
      <ResponsiveModalTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 h-4 w-4" />
          {t('button')}
        </Button>
      </ResponsiveModalTrigger>

      <ResponsiveModalContent title={t('title')} description={t('description')}>
        {step === 'input' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode('file')}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                  mode === 'file' ? 'border-primary bg-primary/5' : 'border-dashed hover:border-muted-foreground'
                }`}
              >
                <FileText className="h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">{t('modeFile')}</span>
                <span className="text-center text-xs text-muted-foreground">PDF, DOCX, TXT</span>
              </button>
              <button
                onClick={() => setMode('url')}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                  mode === 'url' ? 'border-primary bg-primary/5' : 'border-dashed hover:border-muted-foreground'
                }`}
              >
                <Link2 className="h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">{t('modeUrl')}</span>
                <span className="text-xs text-muted-foreground">{t('modeUrlHint')}</span>
              </button>
            </div>

            {mode === 'file' && (
              <div className="space-y-2">
                <Label>{t('fileLabel')}</Label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed py-8 transition-colors hover:bg-muted/50"
                >
                  {isProcessing ? (
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t('fileDrop')}</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.txt,.md"
                  onChange={handleFileChange}
                />
              </div>
            )}

            {mode === 'url' && (
              <div className="space-y-2">
                <Label htmlFor="import-url">{t('urlLabel')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="import-url"
                    placeholder="https://..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUrlImport()}
                  />
                  <Button onClick={handleUrlImport} disabled={isProcessing || !url.trim()}>
                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : t('parseButton')}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <ResponsiveModalClose asChild>
                <Button variant="outline">{t('cancel')}</Button>
              </ResponsiveModalClose>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {t('previewCount', { selected: selectedIds.size, total: drafts.length })}
              </p>
              <button
                onClick={toggleAll}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                {selectedIds.size === drafts.length ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {selectedIds.size === drafts.length ? t('deselectAll') : t('selectAll')}
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {drafts.map((draft) => (
                <button
                  key={draft.id}
                  onClick={() => toggleSelect(draft.id)}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    selectedIds.has(draft.id)
                      ? 'border-primary/50 bg-primary/5'
                      : 'opacity-50 hover:opacity-75'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {selectedIds.has(draft.id) ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{draft.title}</span>
                      <KbCategoryBadge category={draft.category} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {draft.content}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep('input')}>
                {t('back')}
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={selectedIds.size === 0 || isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t('confirmButton', { count: selectedIds.size })}
              </Button>
            </div>
          </div>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
