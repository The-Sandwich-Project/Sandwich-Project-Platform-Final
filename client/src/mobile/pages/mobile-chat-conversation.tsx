import { useRoute, useLocation } from 'wouter';
import { Loader2 } from 'lucide-react';
import { useChatDock } from '@/components/chat/chat-dock-context';
import { ChatConversationScreen } from '@/components/chat/chat-popup-window';

/**
 * Phone screen for a single Team Chat DM (/m/chat/dm/:channelId).
 * Same conversation, event cards and read receipts as the desktop popup.
 */
export function MobileChatConversation() {
  const [, params] = useRoute('/chat/dm/:channelId');
  const [, navigate] = useLocation();
  const { connection } = useChatDock();
  const channelId = params?.channelId ? decodeURIComponent(params.channelId) : '';

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-white"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {connection && channelId ? (
        <ChatConversationScreen
          key={channelId}
          client={connection.client}
          channelId={channelId}
          me={connection.streamUserId}
          onBack={() => navigate('/chat')}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
    </div>
  );
}

export default MobileChatConversation;
