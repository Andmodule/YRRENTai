'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Task, TaskNote } from '@/hooks/use-tasks';
import { useTaskNotes, useUpdateTaskStatus, useAddTaskNote } from '@/hooks/use-tasks';

interface TaskDetailStaffProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
}

export function TaskDetailStaff({ task, open, onClose }: TaskDetailStaffProps) {
  const { data: notesData } = useTaskNotes(task?.uuid ?? null, open && !!task);
  const { mutate: updateStatus, isPending: statusPending } = useUpdateTaskStatus();
  const { mutateAsync: addNote, isPending: notePending } = useAddTaskNote();
  const [noteText, setNoteText] = useState('');
  const [startPrompt, setStartPrompt] = useState(false);

  useEffect(() => {
    if (!open) {
      setNoteText('');
      setStartPrompt(false);
    }
  }, [open, task?.uuid]);

  if (!task) return null;

  const notes = notesData?.notes ?? [];

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

        {task.notes?.trim() && (
          <div className="mb-4">
            <p className="text-xs font-medium text-slate-500">Примечания</p>
            <p className="mt-1 text-sm text-slate-800">{task.notes}</p>
          </div>
        )}

        <Button className="w-full" size="lg" variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </div>
  );
}
