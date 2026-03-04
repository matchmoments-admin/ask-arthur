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
import { Platform } from "react-native";
import * as Application from "expo-application";
import { initNotifications, handleNotificationAction, getExpoPushToken } from "@/lib/notifications";
import { API_URL } from "@/constants/config";

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

  // Initialize notification channels + register push token on app start
  useEffect(() => {
    initNotifications();
    handleNotificationAction(router);

    // Register push token with backend
    (async () => {
      const token = await getExpoPushToken();
      if (token) {
        const deviceId =
          (Platform.OS === "android"
            ? Application.getAndroidId()
            : await Application.getIosIdForVendorAsync()) ??
          `${Platform.OS}-${Date.now()}`;

        try {
          await fetch(`${API_URL}/api/mobile/push/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expoToken: token,
              platform: Platform.OS,
              deviceId,
            }),
          });
        } catch {
          // Silently fail — will retry on next launch
        }
      }
    })();
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
