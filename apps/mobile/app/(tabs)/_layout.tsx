import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { Home, ScanLine, ShieldCheck, Shield, Settings } from "lucide-react-native";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.navy },
        headerTintColor: Colors.textOnDark,
        headerTitleStyle: { fontFamily: Fonts.semiBold },
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopColor: Colors.border,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: { fontFamily: Fonts.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Ask Arthur",
          tabBarLabel: "Home",
          tabBarIcon: ({ color, size }) => (
            <Home size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan QR",
          tabBarLabel: "Scan",
          tabBarIcon: ({ color, size }) => (
            <ScanLine size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="breach"
        options={{
          title: "Breach Check",
          tabBarLabel: "Breach",
          tabBarIcon: ({ color, size }) => (
            <ShieldCheck size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="apps"
        options={{
          title: Platform.OS === "android" ? "App Scanner" : "App Security",
          tabBarLabel: "Apps",
          tabBarIcon: ({ color, size }) => (
            <Shield size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarLabel: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Settings size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
