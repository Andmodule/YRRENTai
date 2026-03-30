'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Inbox } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
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
import type { ConversationDto } from '@/hooks/use-conversations';
import { formatGuestAndProperty } from '@/lib/format/conversation-meta';
import { ConversationStatusDot } from '@/components/inbox/conversation-status-dot';

const showGuestSimulator =
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PUBLIC_ENABLE_GUEST_SIMULATOR === 'true';

export default function ChatPage() {
  const t = useTranslations('inbox');
  const tChat = useTranslations('chat');
  const router = useRouter();
  const { properties, isLoading, isError: propertiesError } = useProperties();
  const [activeConversation, setActiveConversation] = useState<ConversationDto | null>(null);

  useEffect(() => {
    let cancelled = false;

    connectChatSocket()
      .then((s) => {
        if (cancelled) return;
        const pids = properties.map((p) => p.id);
        if (pids.length > 0) {
          s.emit('inbox:subscribe', { propertyIds: pids });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [properties]);

  useEffect(() => {
    return () => {
      disconnectChatSocket();
    };
  }, []);

  const handleSelect = useCallback((conv: ConversationDto) => {
    setActiveConversation(conv);
  }, []);

  const handleMobileBack = useCallback(() => {
    if (activeConversation) {
      setActiveConversation(null);
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/dashboard');
    }
  }, [activeConversation, router]);

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex h-[calc(100vh-8rem)] gap-0 overflow-hidden rounded-xl bg-gray-50 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-muted/25',
          CHAT_FRAME.box,
        )}
      >
        <div className={cn('w-80 bg-background p-3 space-y-2', CHAT_FRAME.r)}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
        <div className="flex-1 bg-background p-6">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
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
    ? formatGuestAndProperty(activeConversation.externalGuestKey, activeConversation.propertyName)
    : t('title');

  const mobileRight = activeConversation ? (
    <ConversationStatusDot status={activeConversation.status} className="size-3 ring-2 ring-background" />
  ) : undefined;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-0 overflow-hidden lg:gap-3 lg:h-[calc(100vh-8rem)]">
      <ChatMobileNav
        title={mobileTitle}
        onBack={handleMobileBack}
        right={mobileRight}
      />

      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden max-lg:pt-14">
        {propertiesError && <BackendUnreachableBanner />}

        {showGuestSimulator && (
          <DevGuestSimulator
            properties={properties}
            syncedPropertyId={defaultPropertyId}
            activeConversation={activeConversation}
          />
        )}

        {/* Master-detail — full bleed on mobile, framed on lg+ */}
        <div
          className={cn(
            'flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-gray-50 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-muted/25',
            CHAT_FRAME.lgBox,
          )}
        >
        <div
          className={cn(
            'flex min-h-0 w-full min-w-0 flex-1 flex-col lg:flex-row',
            'bg-background',
          )}
        >
          {/* List panel */}
          <div
            className={cn(
              'flex min-h-0 w-full shrink-0 flex-col overflow-y-auto bg-background lg:w-80',
              CHAT_FRAME.rLg,
              activeConversation && 'hidden lg:flex',
            )}
          >
            <InboxList
              activeId={activeConversation?.id ?? null}
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
              <ConversationWindow key={activeConversation.id} conversation={activeConversation} />
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
  );
}
