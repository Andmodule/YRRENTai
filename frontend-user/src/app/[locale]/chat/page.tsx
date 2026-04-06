'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, Inbox } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useProperties } from '@/hooks/use-properties';
import {
  InboxList,
  ConversationWindow,
  DevGuestSimulator,
  BackendUnreachableBanner,
} from '@/components/inbox';
import { ChatMobileNav } from '@/components/inbox/chat-mobile-nav';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { CHAT_FRAME } from '@/components/inbox/inbox-ui-tokens';
import { cn } from '@/lib/utils';
import { connectChatSocket, disconnectChatSocket } from '@/lib/socket/client';
import type { ConversationStatus } from '@rentai/shared/constants';
import {
  useConversations,
  sortConversationsByActivity,
  type ConversationDto,
} from '@/hooks/use-conversations';
import { formatGuestAndProperty } from '@/lib/format/conversation-meta';
import { ConversationStatusDot } from '@/components/inbox/conversation-status-dot';
import { TooltipProvider } from '@/components/ui/tooltip';

/** Sync with URL so Android / browser «back» returns to inbox list before leaving /chat */
const CHAT_CONVERSATION_QUERY = 'conversation';

/**
 * Dev-панель «тест гостя» (DevGuestSimulator) скрыта в UI по умолчанию.
 * Включить локально: в `.env` задать `NEXT_PUBLIC_ENABLE_GUEST_SIMULATOR=true` и перезапустить dev-сервер.
 */
const showGuestSimulator = process.env.NEXT_PUBLIC_ENABLE_GUEST_SIMULATOR === 'true';

function ChatLoadingSkeleton() {
  return (
    <div
      className={cn(
        'flex h-full min-h-[280px] gap-0 overflow-hidden rounded-xl border border-slate-200 bg-gray-50 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-900/50',
      )}
    >
      <div className="w-80 border-r border-slate-200 bg-background p-3 space-y-2 dark:border-slate-800 dark:bg-slate-900/40">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
      <div className="flex-1 bg-background p-6 dark:bg-slate-900/30">
        <Skeleton className="h-full w-full rounded-xl" />
      </div>
    </div>
  );
}

function ChatPageContent() {
  const t = useTranslations('inbox');
  const tChat = useTranslations('chat');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const conversationId = searchParams.get(CHAT_CONVERSATION_QUERY);

  const { properties, isLoading, isError: propertiesError } = useProperties();
  const propertiesRef = useRef(properties);
  useEffect(() => {
    propertiesRef.current = properties;
  }, [properties]);

  const { conversations, isLoading: inboxLoading, mutate: mutateConversations } = useConversations({
    limit: 50,
  });

  /** Сразу после POST ответа — без ожидания сокета (иначе лаг точки и плейсхолдера). */
  const handleStaffReplySuccess = useCallback(
    (conversationIdReply: string, content: string) => {
      const preview = content.slice(0, 200);
      const now = new Date().toISOString();
      void mutateConversations(
        (current) => {
          if (!current?.data) return current;
          const cid = conversationIdReply.toLowerCase();
          const nextData = sortConversationsByActivity(
            current.data.map((c) =>
              c.id.toLowerCase() === cid
                ? {
                    ...c,
                    status: 'resolved' as ConversationStatus,
                    lastMessagePreview: preview,
                    lastActivityAt: now,
                  }
                : c,
            ),
          );
          return { ...current, data: nextData };
        },
        /** Сначала синхронный патч кэша (все точки из одного источника), затем фоновый GET */
        { revalidate: true },
      );
    },
    [mutateConversations],
  );

  const stripConversationFromUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(CHAT_CONVERSATION_QUERY);
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }, [pathname, router, searchParams]);

  const handleDevChatsCleared = useCallback(() => {
    stripConversationFromUrl();
    void mutateConversations(undefined, { revalidate: true });
  }, [mutateConversations, stripConversationFromUrl]);

  const activeConversation = useMemo(() => {
    if (!conversationId) return null;
    const aid = conversationId.toLowerCase();
    return conversations.find((c) => c.id.toLowerCase() === aid) ?? null;
  }, [conversationId, conversations]);

  useEffect(() => {
    if (!conversationId || inboxLoading) return;
    const aid = conversationId.toLowerCase();
    if (!conversations.some((c) => c.id.toLowerCase() === aid)) {
      stripConversationFromUrl();
    }
  }, [conversationId, conversations, inboxLoading, stripConversationFromUrl]);

  /**
   * Сервер шлёт `conversation:updated` / `message:saved` в комнаты `inbox:${propertyId}`.
   * После reconnect Socket.IO клиент в них не состоит — подписываемся снова на connect/reconnect
   * и при смене списка объектов (ref — актуальные id после загрузки properties).
   */
  useEffect(() => {
    let alive = true;
    let detach: (() => void) | undefined;

    connectChatSocket()
      .then((s) => {
        if (!alive) return;

        const subscribeInboxRooms = () => {
          const pids = propertiesRef.current.map((p) => p.id);
          if (pids.length === 0) return;
          s.emit('inbox:subscribe', { propertyIds: pids });
        };

        subscribeInboxRooms();
        s.on('connect', subscribeInboxRooms);
        s.on('reconnect', subscribeInboxRooms);
        detach = () => {
          s.off('connect', subscribeInboxRooms);
          s.off('reconnect', subscribeInboxRooms);
        };
      })
      .catch(() => {});

    return () => {
      alive = false;
      detach?.();
    };
  }, [properties]);

  useEffect(() => {
    return () => {
      disconnectChatSocket();
    };
  }, []);

  const handleSelect = useCallback(
    (conv: ConversationDto) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(CHAT_CONVERSATION_QUERY, conv.id);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const handleMobileBack = useCallback(() => {
    if (conversationId) {
      stripConversationFromUrl();
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/dashboard');
    }
  }, [conversationId, router, stripConversationFromUrl]);

  if (isLoading) {
    return <ChatLoadingSkeleton />;
  }

  /** API down and no cached properties — only show fix hint */
  if (!isLoading && propertiesError && properties.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <BackendUnreachableBanner />
      </div>
    );
  }

  if (!isLoading && properties.length === 0) {
    return (
      <EmptyState
        icon={<Building2 className="h-12 w-12" />}
        title={tChat('noProperties')}
        description={tChat('noPropertiesHint')}
        action={
          <Button asChild>
            <Link href="/properties">{tChat('goToProperties')}</Link>
          </Button>
        }
      />
    );
  }

  const defaultPropertyId = properties[0]?.id ?? null;

  const mobileTitle = activeConversation
    ? formatGuestAndProperty(
        activeConversation.externalGuestKey,
        activeConversation.propertyName,
        activeConversation.guestDisplayName,
      )
    : t('title');

  const mobileRight = activeConversation ? (
    <ConversationStatusDot status={activeConversation.status} className="size-3 ring-2 ring-background" />
  ) : undefined;

  return (
    <TooltipProvider delayDuration={280}>
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-0 overflow-hidden lg:gap-3">
        <ChatMobileNav
          title={mobileTitle}
          variant={activeConversation ? 'conversation' : 'list'}
          onBack={handleMobileBack}
          right={mobileRight}
        />

        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden max-lg:pt-14">
          {propertiesError && (
            <div className="shrink-0">
              <BackendUnreachableBanner />
            </div>
          )}

          {showGuestSimulator && (
            <div className="shrink-0">
              <DevGuestSimulator
                properties={properties}
                syncedPropertyId={defaultPropertyId}
                activeConversation={activeConversation}
                onChatsCleared={handleDevChatsCleared}
              />
            </div>
          )}

          {/* Master-detail — светлая тема как раньше (серый фон + белые панели); тёмная — сланец, не чистый чёрный */}
          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
              'border border-slate-200 bg-gray-50 shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
              'dark:border-slate-800 dark:bg-slate-900/45 dark:shadow-none',
              CHAT_FRAME.lgBox,
            )}
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background lg:flex-row dark:bg-slate-900/35">
              {/* List panel */}
              <div
                className={cn(
                  'flex min-h-0 w-full shrink-0 flex-col overflow-y-auto bg-background lg:h-auto lg:max-h-full lg:w-80',
                  CHAT_FRAME.rLg,
                  activeConversation && 'hidden lg:flex',
                )}
              >
                <InboxList
                  conversations={conversations}
                  isLoading={inboxLoading}
                  activeId={conversationId}
                  onSelect={handleSelect}
                />
              </div>

              {/* Detail panel */}
              <div
                className={cn(
                  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background',
                  !activeConversation && 'hidden lg:flex',
                )}
              >
                {activeConversation ? (
                  <ConversationWindow
                    key={activeConversation.id}
                    conversation={activeConversation}
                    onStaffReplySuccess={handleStaffReplySuccess}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                    <Inbox className="mb-3 h-12 w-12 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">{t('selectConversation')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatLoadingSkeleton />}>
      <ChatPageContent />
    </Suspense>
  );
}
