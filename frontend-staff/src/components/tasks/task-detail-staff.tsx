'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import type { Task, TaskNote } from '@/hooks/use-tasks';
import {
  useTaskNotes,
  useUpdateTaskStatus,
  useAddTaskNote,
  useTaskChecklist,
  usePatchTaskChecklistItem,
} from '@/hooks/use-tasks';
import { strings } from '@/strings/tasks';
import { stripStaffSeedTaskMarker } from '@rentai/shared';

interface TaskDetailStaffProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  /** Increment to scroll first required-unchecked checklist row into view after open */
  checklistScrollNonce?: number;
}

export function TaskDetailStaff({
  task,
  open,
  onClose,
  checklistScrollNonce = 0,
}: TaskDetailStaffProps) {
  const { data: notesData } = useTaskNotes(task?.uuid ?? null, open && !!task);
  const { data: checklistData } = useTaskChecklist(task?.uuid ?? null, open && !!task);
  const { mutate: patchChecklist, isPending: checklistPending } = usePatchTaskChecklistItem();
  const { mutate: updateStatus, isPending: statusPending } = useUpdateTaskStatus();
  const { mutateAsync: addNote, isPending: notePending } = useAddTaskNote();
  const [noteText, setNoteText] = useState('');
  const [startPrompt, setStartPrompt] = useState(false);

  const notes = notesData?.notes ?? [];
  const checklistItems = checklistData?.items ?? [];
  const checklistDone = checklistItems.filter((i) => i.checked).length;
  const checklistTotal = checklistItems.length;

  useEffect(() => {
    if (!open) {
      setNoteText('');
      setStartPrompt(false);
    }
  }, [open, task?.uuid]);

  useEffect(() => {
    if (!open || !task || checklistScrollNonce <= 0) return;
    const hasTarget = checklistItems.some((i) => i.required && !i.checked);
    if (!hasTarget) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector('[data-required-unchecked]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
    return () => window.clearTimeout(t);
  }, [open, task?.uuid, checklistScrollNonce, checklistItems]);

  if (!task) return null;

  const taskNotesForDisplay = stripStaffSeedTaskMarker(task.notes);

  const handleStart = () => {
    updateStatus({ uuid: task.uuid, status: 'in_progress' });
    setStartPrompt(false);
    onClose();
  };

  const submitNote = async () => {
    if (!noteText.trim()) return;
    await addNote({ uuid: task.uuid, text: noteText.trim() });
    setNoteText('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-slate-900/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" aria-hidden />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">{task.propertyTitle}</h2>
            <p className="truncate text-sm text-slate-500" title={task.streetAddress || task.propertyAddress}>
              {task.streetAddress || task.propertyAddress}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {task.contextLabel && (
          <div className="mb-4 rounded-2xl border border-teal-100 bg-teal-50/90 px-4 py-3 text-sm text-teal-900">
            {task.contextLabel}
          </div>
        )}

        {checklistTotal > 0 && (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4" aria-live="polite">
            <p className="mb-2 text-xs font-semibold uppercase text-slate-500">{strings.tasks.checklist.title}</p>
            <p className="mb-2 text-sm text-slate-700">
              {strings.tasks.checklist.progress(checklistDone, checklistTotal)}
            </p>
            <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-teal-500 transition-all duration-200 ease-out"
                style={{ width: `${checklistTotal ? (checklistDone / checklistTotal) * 100 : 0}%` }}
              />
            </div>
            <ul className="space-y-3">
              {checklistItems.map((item) => (
                <li
                  key={item.uuid}
                  className="flex min-h-12 items-start gap-3"
                  {...(item.required && !item.checked ? { 'data-required-unchecked': '' } : {})}
                  data-checklist-text={item.text}
                >
                  <Checkbox
                    id={`cl-${item.uuid}`}
                    checked={item.checked}
                    disabled={checklistPending}
                    className="mt-1"
                    aria-label={`${item.text}${item.required ? `, ${strings.tasks.checklist.requiredBadge}` : ''}`}
                    onCheckedChange={(c) => {
                      if (task?.uuid)
                        patchChecklist({
                          taskUuid: task.uuid,
                          itemId: item.uuid,
                          checked: c === true,
                        });
                    }}
                  />
                  <label htmlFor={`cl-${item.uuid}`} className="flex-1 cursor-pointer text-sm leading-snug text-slate-800">
                    <span className={item.checked ? 'text-slate-400 line-through' : ''}>{item.text}</span>
                    {item.required && (
                      <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                        {strings.tasks.checklist.requiredBadge}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {task.status === 'pending' && (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            {!startPrompt ? (
              <Button className="w-full" onClick={() => setStartPrompt(true)}>
                Начать задачу
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-center text-sm text-slate-700">Начать сейчас?</p>
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={statusPending} onClick={handleStart}>
                    Начать
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setStartPrompt(false)}>
                    Позже
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Заметки для менеджера</p>
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/80 p-3">
            {notes.length === 0 ? (
              <p className="text-sm text-slate-500">Пока нет заметок</p>
            ) : (
              notes.map((n: TaskNote) => (
                <div key={n.uuid} className="rounded-lg bg-white p-2 text-sm shadow-sm">
                  <p className="text-xs text-slate-400">{n.authorName}</p>
                  <p className="text-slate-800">{n.text}</p>
                  {n.photoUrl && (
                    <a href={n.photoUrl} target="_blank" rel="noreferrer" className="mt-1 block text-teal-700">
                      Фото
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
          <Textarea
            className="mt-2"
            rows={2}
            placeholder="Короткое сообщение менеджеру…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <Button
            className="mt-2 w-full"
            size="sm"
            disabled={notePending || !noteText.trim()}
            onClick={() => void submitNote()}
          >
            Отправить
          </Button>
        </div>

        {taskNotesForDisplay && (
          <div className="mb-4">
            <p className="text-xs font-medium text-slate-500">Примечания</p>
            <p className="mt-1 text-sm text-slate-800">{taskNotesForDisplay}</p>
          </div>
        )}

        <Button className="w-full" size="lg" variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </div>
  );
}
