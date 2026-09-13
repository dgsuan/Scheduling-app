import { ScrollView } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { AccountSection } from "@/components/settings/AccountSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { BackupSection } from "@/components/settings/BackupSection";
import { InstallSection } from "@/components/settings/InstallSection";
import { RemindersSection } from "@/components/settings/RemindersSection";
import { SemesterSection } from "@/components/settings/SemesterSection";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";

export default function SettingsScreen() {
  const { desktop } = useBreakpoint();
  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName={cn("w-full max-w-[720px] gap-10 self-center pb-24", desktop ? "px-10 pt-10" : "px-5 pt-6")}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader title="Settings" subtitle="Make it yours, set your semester, and keep your data safe." />
      <AccountSection />
      <SemesterSection />
      <RemindersSection />
      <AppearanceSection />
      <BackupSection />
      <InstallSection />
    </ScrollView>
  );
}
