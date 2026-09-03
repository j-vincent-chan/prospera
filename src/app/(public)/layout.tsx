import Image from "next/image";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Chrome for pages people open from an email without a Prospera account:
 * the biosketch authorization page now, the shared brief later. Brand bar,
 * no sign-in affordance, fluid to 390px.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-canvas">
        <header className="flex items-center justify-between border-b border-line bg-card px-6 py-4 sm:px-8">
          <span className="flex items-center gap-2.5" title="Prospera">
            <Image src="/brand/prospera-app-icon.png" alt="" width={180} height={198} priority className="h-[30px] w-auto" />
            <Image src="/brand/prospera-wordmark.png" alt="Prospera" width={555} height={115} priority className="h-[18px] w-auto" />
          </span>
          <span className="text-meta text-ink-muted">Office of Collaborative Research · UCSF</span>
        </header>
        <main className="flex flex-1 flex-col items-center px-4 pb-16 pt-10 sm:px-6">{children}</main>
      </div>
    </ToastProvider>
  );
}
