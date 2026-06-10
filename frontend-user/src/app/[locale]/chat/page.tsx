import { Suspense } from 'react';
import { ChatLoadingSkeleton, ChatPageClient } from './chat-page-client';

function guestSimulatorEnabled(): boolean {
  const truthy = (v: string | undefined) => v === 'true' || v === '1' || v === 'yes';
  return (
    truthy(process.env.ENABLE_GUEST_SIMULATOR) ||
    truthy(process.env.NEXT_PUBLIC_ENABLE_GUEST_SIMULATOR)
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatLoadingSkeleton />}>
      <ChatPageClient showGuestSimulator={guestSimulatorEnabled()} />
    </Suspense>
  );
}
