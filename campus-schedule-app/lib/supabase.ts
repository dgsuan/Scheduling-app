import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

// Supabase client for sign-in and sync. The app stays fully usable without
// it: when the keys aren't configured, `supabase` is null and everything
// keeps working locally, exactly as before.
//
// Keys come from EXPO_PUBLIC_* env vars (see .env.example). The publishable
// key is meant to be public; Row Level Security protects the data.

if (Platform.OS !== "web") {
  // React Native lacks a spec-complete URL implementation; the web has one.
  require("react-native-url-polyfill/auto");
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = !!url && !!publishableKey;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: Platform.OS === "web",
      },
    })
  : null;

// Native apps should only refresh the session while in the foreground.
if (supabase && Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
