'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useChat } from '@/hooks/use-chat';
import { ChatMessageBubble, StreamingBubble } from './chat-message-bubble';
import { ChatInput } from './chat-input';
import { MessageSquare, Wifi, WifiOff } from 'lucide-react';

interface ChatWindowProps {
  propertyId: string;
  propertyName: string;
}

export function ChatWindow({ propertyId, propertyName }: ChatWindowProps) {
  const t = useTranslations('chat');
  const { messages, streamingText, isStreaming, isConnected, error, sendMessage } = useChat(propertyId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{propertyName}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          {isConnected ? (
            <>
              <Wifi className="h-3.5 w-3.5 text-green-500" />
              <span className="text-green-600">{t('connected')}</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5 text-destructive" />
              <span className="text-destructive">{t('disconnected')}</span>
            </>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">{t('emptyChat')}</p>
            <p className="mt-1 text-xs text-muted-foreground/70">{t('emptyChatHint')}</p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
        {isStreaming && <StreamingBubble text={streamingText} />}
      </div>

      {error && (
        <div className="border-t bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="border-t p-4">
        <ChatInput onSend={sendMessage} disabled={!isConnected || isStreaming} />
      </div>
    </div>
  );
}
