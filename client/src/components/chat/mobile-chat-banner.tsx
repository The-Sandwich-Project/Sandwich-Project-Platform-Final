import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { MessageCircle, X } from 'lucide-react';
import { useChatDock } from './chat-dock-context';

/**
 * Phones don't get popups (no room). A new DM shows as a brief banner at the
 * top of the screen instead; tapping it opens that conversation.
 */
export function MobileChatBanner() {
  const { mobileBanner, dismissMobileBanner } = useChatDock();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (!mobileBanner) return;
    const t = setTimeout(dismissMobileBanner, 8000);
    return () => clearTimeout(t);
  }, [mobileBanner, dismissMobileBanner]);

  if (!mobileBanner) return null;
  const inMobileShell = location === '/m' || location.startsWith('/m/');

  return (
    <div
      className="fixed inset-x-2 z-[10002] rounded-xl border border-gray-200 bg-white shadow-xl"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
      role="status"
    >
      <div className="flex items-start gap-3 p-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={() => {
            dismissMobileBanner();
            navigate(
              inMobileShell
                ? mobileBanner.channelId
                  ? `/m/chat/dm/${encodeURIComponent(mobileBanner.channelId)}`
                  : '/m/chat'
                : '/dashboard?section=chat&tab=dms'
            );
          }}
        >
          <span className="mt-0.5 rounded-full bg-[#236383] p-1.5 text-white">
            <MessageCircle className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-gray-900">{mobileBanner.senderName}</span>
            <span className="block truncate text-sm text-gray-600">{mobileBanner.preview}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={dismissMobileBanner}
          className="rounded p-1 text-gray-400 hover:text-gray-700"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
