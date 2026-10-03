/*
 * Whether this browser can read MSX: the MSX connector on the SE's PC (beside msx-mcp) and its MSX sign-in. Says
 * plainly what to do when it isn't there; Cloud Delivery itself never reads MSX or holds MSX credentials.
 */
import { useMutation } from "@tanstack/react-query";
import { Copy, Plug, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { useConnector } from "@/components/customer/hooks";
import { Button } from "@/components/ui/button";
import { connectorSignIn } from "@/lib/msx-connector";

const RUN = `node "%USERPROFILE%\\Downloads\\msx-connector.mjs" --install`;

export function MsxConnect() {
  const conn = useConnector();
  const signIn = useMutation({
    mutationFn: connectorSignIn,
    onSuccess: () => {
      toast.success("Signed in to MSX.");
      void conn.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const s = conn.data;
  if (!s) return null;
  if (s.state === "ready")
    return (
      <Pill tone="success">
        <Plug className="size-3" /> MSX connected
      </Pill>
    );

  return (
    <div
      role="region"
      aria-label="MSX connection"
      className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-[12.5px]"
    >
      {s.state === "off" ? (
        <>
          <p className="font-medium">MSX isn't connected on this PC.</p>
          <p className="text-muted-foreground">
            Cloud Delivery reads MSX through the MSX connector, a small program that runs on your PC
            beside msx-mcp and reads MSX as you. Cloud Delivery never sees your MSX sign-in.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>
              msx-mcp in your home folder as <code className="font-mono">msx-mcp</code> (from
              github.com/mcaps-microsoft/msx-mcp, with your Microsoft EMU account).
            </li>
            <li>
              <a className="text-primary underline" href="/msx-connector.mjs" download>
                Download the MSX connector
              </a>
              , then run it once:
              <span className="mt-1 flex items-center gap-1.5">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">
                  {RUN}
                </code>
                <button
                  aria-label="Copy command"
                  onClick={() => {
                    void navigator.clipboard.writeText(RUN);
                    toast.success("Copied.");
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-3.5" />
                </button>
              </span>
              <span className="mt-0.5 block">
                It starts now and whenever you sign in to Windows. Remove it with{" "}
                <code className="font-mono">--uninstall</code>.
              </span>
            </li>
            <li>Corporate VPN on. If the browser asks to allow local network access, allow it.</li>
          </ol>
        </>
      ) : s.state === "signed-out" ? (
        <>
          <p className="font-medium">Sign in to MSX</p>
          <p className="text-muted-foreground">
            The connector is running. Sign in once with your @microsoft.com account; a browser
            window opens.
          </p>
          <Button size="sm" disabled={signIn.isPending} onClick={() => signIn.mutate()}>
            {signIn.isPending ? "Waiting for sign-in…" : "Sign in to MSX"}
          </Button>
        </>
      ) : (
        <>
          <p className="font-medium">MSX didn't answer.</p>
          <p className="text-muted-foreground">
            {s.detail ?? "Unknown error."} Check the VPN, then try again.
          </p>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={() => void conn.refetch()}>
        <RefreshCw className="size-3.5" /> Check again
      </Button>
    </div>
  );
}
