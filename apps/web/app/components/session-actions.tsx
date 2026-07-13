"use client";

import { Bell, SignOut } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrowserNotificationController, browserNotificationApi } from "../browser-notifications";
import { authApi } from "../lib/client-api";
import { Button } from "./ui";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      className="button-quiet"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await authApi.signOut();
          router.push("/sign-in");
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      <SignOut aria-hidden />
      {pending ? "Signing out" : "Sign out"}
    </Button>
  );
}

export function BrowserNotificationButton() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof window === "undefined" || !("Notification" in window)
      ? "unsupported"
      : window.Notification.permission,
  );
  return (
    <Button
      className="button-quiet"
      disabled={permission === "unsupported" || permission === "granted"}
      onClick={async () =>
        setPermission(
          (await new BrowserNotificationController(browserNotificationApi()).optIn(true)) as
            NotificationPermission | "unsupported",
        )
      }
      aria-describedby="browser-notification-status"
    >
      <Bell aria-hidden />
      {permission === "granted"
        ? "Browser alerts on"
        : permission === "denied"
          ? "Browser alerts blocked"
          : permission === "unsupported"
            ? "Alerts unavailable"
            : "Enable browser alerts"}
      <span className="sr-only" id="browser-notification-status">
        Persisted in-game notifications remain available regardless of this browser setting.
      </span>
    </Button>
  );
}
