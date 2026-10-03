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
            Cloud Delivery reads MSX through the MSX connector, a small program on your PC that uses
            msx-mcp to read MSX as you. Cloud Delivery never sees your MSX sign-in. Set it up once:
          </p>
          <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
            <li>
              <a
                className="font-medium text-primary underline"
                href="/install-msx-connector.cmd"
                download="Install MSX connector.cmd"
              >
                Download Install MSX connector
              </a>{" "}
              and double-click it. If Edge or Windows asks whether to keep or run it, choose Keep,
              then More info, Run anyway. It checks Node.js, gets msx-mcp if you don't have it (your
              browser downloads it with your Microsoft EMU account), and starts the connector now
              and whenever you sign in to Windows.
            </li>
            <li>Keep the corporate VPN on.</li>
            <li>
              When Edge asks to let this site access apps and services on this device, click Allow.
              If you blocked it before: the icon left of the address, Site permissions, Local
              network access, Allow. Then reload.
            </li>
          </ol>
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">Other ways to install</summary>
            <p className="mt-1">
              With Node.js 22+ and msx-mcp in{" "}
              <code className="font-mono">%USERPROFILE%\msx-mcp</code>:{" "}
              <a className="text-primary underline" href="/msx-connector.mjs" download>
                download the connector
              </a>{" "}
              and run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]">{RUN}</code>
              <button
                aria-label="Copy command"
                onClick={() => {
                  void navigator.clipboard.writeText(RUN);
                  toast.success("Copied.");
                }}
                className="ml-1 align-middle text-muted-foreground hover:text-foreground"
              >
                <Copy className="size-3.5" />
              </button>
              . Remove it with <code className="font-mono">--uninstall</code>.
            </p>
          </details>
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
