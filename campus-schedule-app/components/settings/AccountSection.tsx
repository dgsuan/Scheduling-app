import { CloudCheck, CloudOff, Loader, MailCheck, RefreshCw, TriangleAlert } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { MIN_PASSWORD_LENGTH, useAuth } from "@/context/auth";
import { relativeTime, requestSyncNow, useSyncState } from "@/lib/sync";

// Sign in / create an account, and see sync status.

function SignInForm() {
  const auth = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setInfo(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    if (mode === "signin") {
      const r = await auth.signIn(email, password);
      if (r.error) setError(r.error);
    } else {
      const r = await auth.signUp(email, password);
      if (r.error) setError(r.error);
      else if (r.needsConfirmation) {
        setAwaitingConfirm(email.trim());
        setMode("signin");
        setPassword("");
      }
    }
    setBusy(false);
  };

  const forgot = async () => {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError("Type your email above first, then tap “Forgot password?”.");
      return;
    }
    setBusy(true);
    const r = await auth.sendPasswordReset(email);
    setBusy(false);
    if (r.error) setError(r.error);
    else setInfo(`If an account exists for ${email.trim()}, a reset link is on its way.`);
  };

  return (
    <View className="gap-3 p-4">
      {awaitingConfirm ? (
        <View className="border-primary/30 bg-primary/10 flex-row gap-2.5 rounded-lg border p-3" role="status">
          <Icon as={MailCheck} size={16} className="text-primary mt-0.5" />
          <View className="flex-1 gap-1">
            <Text className="text-sm font-semibold">Check your inbox</Text>
            <Text className="text-muted-foreground text-sm leading-5">
              We sent a confirmation link to {awaitingConfirm}. Click it, then sign in here.
            </Text>
            <Button
              variant="link"
              size="sm"
              className="h-6 self-start px-0"
              onPress={async () => {
                const r = await auth.resendConfirmation(awaitingConfirm);
                setInfo(r.error ? null : "Sent again.");
                setError(r.error ?? null);
              }}
            >
              <Text className="text-xs">Resend the email</Text>
            </Button>
          </View>
        </View>
      ) : null}

      <SegmentedControl
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(null);
        }}
        options={[
          { value: "signin", label: "Sign in" },
          { value: "signup", label: "Create account" },
        ]}
        accessibilityLabel="Sign in or create an account"
      />
      <Input
        value={email}
        onChangeText={setEmail}
        placeholder="you@up.edu.ph"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        accessibilityLabel="Email"
      />
      <Input
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        placeholder={mode === "signup" ? `Password (at least ${MIN_PASSWORD_LENGTH} characters)` : "Password"}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        textContentType={mode === "signup" ? "newPassword" : "password"}
        accessibilityLabel="Password"
      />
      {error ? (
        <Text className="text-destructive text-sm" role="alert">
          {error}
        </Text>
      ) : null}
      {info ? <Text className="text-muted-foreground text-sm">{info}</Text> : null}
      <View className="flex-row flex-wrap items-center gap-2">
        <Button onPress={submit} disabled={busy}>
          <Text>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</Text>
        </Button>
        {mode === "signin" ? (
          <Button variant="ghost" size="sm" onPress={forgot} disabled={busy}>
            <Text className="text-muted-foreground">Forgot password?</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function SetNewPasswordDialog() {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={auth.recovering}>
      <DialogContent className="gap-4 p-5 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Set a new password</DialogTitle>
          <DialogDescription>You opened a password reset link. Choose a new password for {auth.user?.email}.</DialogDescription>
        </DialogHeader>
        <Input
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          accessibilityLabel="New password"
        />
        {error ? (
          <Text className="text-destructive text-sm" role="alert">
            {error}
          </Text>
        ) : null}
        <Button
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            const r = await auth.updatePassword(password);
            setBusy(false);
            setError(r.error ?? null);
          }}
        >
          <Text>{busy ? "Saving…" : "Save new password"}</Text>
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function SyncStatus() {
  const sync = useSyncState();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const view =
    sync.phase === "error"
      ? { icon: TriangleAlert, tone: "text-warning", text: sync.error ?? "Sync failed." }
      : sync.phase === "syncing" || sync.phase === "connecting"
        ? { icon: Loader, tone: "text-muted-foreground", text: "Syncing…" }
        : sync.phase === "choice"
          ? { icon: TriangleAlert, tone: "text-warning", text: "Waiting for you to choose what to keep." }
          : sync.phase === "synced" && sync.lastSyncedAt
            ? { icon: CloudCheck, tone: "text-success", text: `Synced ${relativeTime(sync.lastSyncedAt)}` }
            : { icon: CloudOff, tone: "text-muted-foreground", text: "Not synced yet" };

  return (
    <View className="flex-row items-center gap-2" role="status" aria-live="polite">
      <Icon as={view.icon} size={15} className={view.tone} />
      <Text className="flex-1 text-sm">{view.text}</Text>
      <Button variant="ghost" size="sm" onPress={requestSyncNow} disabled={sync.phase === "syncing"} accessibilityLabel="Sync now">
        <Icon as={RefreshCw} size={14} className="text-muted-foreground" />
        <Text className="text-muted-foreground">Sync now</Text>
      </Button>
    </View>
  );
}

export function AccountSection() {
  const auth = useAuth();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  if (!auth.configured) return null;

  return (
    <SettingsSection
      title="Account & sync"
      description={
        auth.user
          ? "Your data syncs to your account and to every device you sign in on."
          : "Sign in to keep your courses, tasks and notes in sync between your phone and laptop. Without an account, everything stays on this device."
      }
    >
      {!auth.ready ? (
        <Text className="text-muted-foreground p-4 text-sm">Checking your account…</Text>
      ) : auth.user ? (
        <>
          <SettingsRow label="Signed in" hint={auth.user.email ?? undefined}>
            <Button variant="outline" size="sm" onPress={() => setConfirmSignOut(true)}>
              <Text>Sign out</Text>
            </Button>
          </SettingsRow>
          <SettingsRow label="Sync" stacked last>
            <SyncStatus />
          </SettingsRow>
        </>
      ) : (
        <SignInForm />
      )}

      <SetNewPasswordDialog />
      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title="Sign out?"
        description="Your data stays on this device — it just stops syncing until you sign in again."
        confirmLabel="Sign out"
        onConfirm={() => {
          setConfirmSignOut(false);
          auth.signOut();
        }}
      />
    </SettingsSection>
  );
}
