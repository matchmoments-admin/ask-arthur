// Which `message` events the offscreen document accepts from the Turnstile
// bridge iframe. Only a message whose origin is the bridge page's origin AND
// whose source is that iframe's window is relayed to the background worker;
// anything else on the offscreen document's window is ignored.

export function isBridgeMessage(
  event: Pick<MessageEvent, "origin" | "source">,
  bridgeUrl: string,
  frameWindow: Window | null | undefined,
): boolean {
  let bridgeOrigin: string;
  try {
    bridgeOrigin = new URL(bridgeUrl).origin;
  } catch {
    return false;
  }
  return (
    !!frameWindow && event.origin === bridgeOrigin && event.source === frameWindow
  );
}
