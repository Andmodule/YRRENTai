'use client';

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Upload, Link2, CheckSquare, Square, Loader2, FileText, ClipboardPaste } from 'lucide-react';
import {
  ResponsiveModal,
  ResponsiveModalTrigger,
  ResponsiveModalContent,
  ResponsiveModalClose,
} from '@/components/ui/responsive-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

type ImportMode = 'idle' | 'file' | 'url' | 'text';
type ImportStep = 'input' | 'preview' | 'done';

interface KbImportDialogProps {
  propertyId: string;
  onConfirmed: () => void;
}

export function KbImportDialog({ propertyId, onConfirmed }: KbImportDialogProps) {
  const t = useTranslations('kb');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>('idle');
  const [step, setStep] = useState<ImportStep>('input');
  const [url, setUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
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
      setPastedText('');
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
      toast.error(t('import.errorParse'));
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
      toast.error(t('import.errorParse'));
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleTextImport() {
    if (!pastedText.trim()) {
      toast.error(t('import.textTooShort'));
      return;
    }
    setIsProcessing(true);
    try {
      const res = await apiClient.post<ImportResponse>(
        `/knowledge-base/${propertyId}/import/text`,
        { text: pastedText },
      );
      openPreview(res.data.data.drafts);
    } catch {
      toast.error(t('import.errorParse'));
    } finally {
      setIsProcessing(false);
    }
  }

  function openPreview(items: Draft[]) {
    if (items.length === 0) {
      toast.message(t('import.emptyResult'));
      return;
    }
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
      toast.success(t('import.confirmSuccess', { count: res.data.data.saved }));
      onConfirmed();
      handleClose();
    } catch {
      toast.error(t('import.errorConfirm'));
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <ResponsiveModal open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
      <ResponsiveModalTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 h-4 w-4" />
          {t('import.button')}
        </Button>
      </ResponsiveModalTrigger>

      <ResponsiveModalContent title={t('import.title')} description={t('import.description')}>
        {step === 'input' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setMode('file')}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                  mode === 'file' ? 'border-primary bg-primary/5' : 'border-dashed hover:border-muted-foreground'
                }`}
              >
                <FileText className="h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">{t('import.modeFile')}</span>
                <span className="text-center text-xs text-muted-foreground">PDF, DOCX, TXT</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('url')}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                  mode === 'url' ? 'border-primary bg-primary/5' : 'border-dashed hover:border-muted-foreground'
                }`}
              >
                <Link2 className="h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">{t('import.modeUrl')}</span>
                <span className="text-xs text-muted-foreground">{t('import.modeUrlHint')}</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('text')}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                  mode === 'text' ? 'border-primary bg-primary/5' : 'border-dashed hover:border-muted-foreground'
                }`}
              >
                <ClipboardPaste className="h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">{t('import.modeText')}</span>
                <span className="text-xs text-muted-foreground">{t('import.modeTextHint')}</span>
              </button>
            </div>

            {mode === 'file' && (
              <div className="space-y-2">
                <Label>{t('import.fileLabel')}</Label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed py-8 transition-colors hover:bg-muted/50"
                >
                  {isProcessing ? (
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t('import.fileDrop')}</p>
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
                <Label htmlFor="import-url">{t('import.urlLabel')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="import-url"
                    placeholder="https://..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUrlImport()}
                  />
                  <Button onClick={handleUrlImport} disabled={isProcessing || !url.trim()}>
                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : t('import.parseButton')}
                  </Button>
                </div>
              </div>
            )}

            {mode === 'text' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="import-text">{t('import.textLabel')}</Label>
                  <span className="text-xs text-muted-foreground">
                    {t('import.textCounter', { count: pastedText.length })}
                  </span>
                </div>
                <Textarea
                  id="import-text"
                  placeholder={t('import.textPlaceholder')}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  rows={10}
                  maxLength={40000}
                  className="min-h-[200px] resize-y font-mono text-sm"
                />
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={() => void handleTextImport()}
                  disabled={isProcessing || !pastedText.trim()}
                >
                  {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('import.parseButton')}
                </Button>
              </div>
            )}

            <div className="flex justify-end">
              <ResponsiveModalClose asChild>
                <Button variant="outline">{t('import.cancel')}</Button>
              </ResponsiveModalClose>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {t('import.previewCount', { selected: selectedIds.size, total: drafts.length })}
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
                {selectedIds.size === drafts.length ? t('import.deselectAll') : t('import.selectAll')}
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
                {t('import.back')}
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={selectedIds.size === 0 || isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t('import.confirmButton', { count: selectedIds.size })}
              </Button>
            </div>
          </div>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
