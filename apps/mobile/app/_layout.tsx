import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import {
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
} from "@expo-google-fonts/public-sans";
import * as SplashScreen from "expo-splash-screen";
import { useShareIntentContext, ShareIntentProvider } from "expo-share-intent";
import { Colors } from "@/constants/colors";
import { normalizeSharedContent } from "@/lib/share-handler";
import { initNotifications, handleNotificationAction } from "@/lib/notifications";

SplashScreen.preventAutoHideAsync();

function RootLayoutInner() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();

  const [fontsLoaded] = useFonts({
    PublicSans_400Regular,
    PublicSans_500Medium,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
  });

  // Initialize notification channels on app start
  useEffect(() => {
    initNotifications();
    handleNotificationAction(router);
  }, [router]);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Navigate to home with shared data when a share intent arrives
  useEffect(() => {
    if (hasShareIntent && shareIntent) {
      const shared = normalizeSharedContent(shareIntent);
      router.replace({
        pathname: "/",
        params: {
          sharedText: shared.text ?? "",
          sharedImages: shared.images ? JSON.stringify(shared.images) : "",
        },
      });
      resetShareIntent();
    }
  }, [hasShareIntent, shareIntent, resetShareIntent, router]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.navy },
          headerTintColor: Colors.textOnDark,
          headerTitleStyle: { fontFamily: "PublicSans_600SemiBold" },
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <RootLayoutInner />
    </ShareIntentProvider>
  );
}
