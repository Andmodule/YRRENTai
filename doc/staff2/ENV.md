# Переменные окружения: голосовой отчёт Staff

Ключи **те же**, что для менеджерского `POST /tasks/voice-parse` — задаются в `.env` у **backend** (или корневом `.env`, если так настроен запуск).

| Переменная | Назначение |
|------------|------------|
| `GROQ_API_KEY` | Groq Cloud — транскрипция Whisper (`whisper-large-v3` по умолчанию). Без ключа STT отключён, превью уходит в эвристику. |
| `VOICE_PARSE_GROQ_WHISPER_MODEL` | Опционально, модель Whisper на Groq (по умолчанию `whisper-large-v3`). |
| `DEEPSEEK_API_KEY` | DeepSeek Chat — разбор речи в JSON (статус задачи, инцидент, вопросы). Без ключа после STT остаётся эвристика. |
| `DEEPSEEK_BASE_URL` | Обычно `https://api.deepseek.com`. |

После изменения `.env` перезапустите backend.

См. также `backend/.env.example`.
