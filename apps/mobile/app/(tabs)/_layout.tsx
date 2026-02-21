import { Tabs } from "expo-router";
import { Colors } from "@/constants/colors";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Scan",
          tabBarLabel: "Scan",
        }}
      />
      <Tabs.Screen
        name="check"
        options={{
          title: "Check Text",
          tabBarLabel: "Check",
        }}
      />
      <Tabs.Screen
        name="breach"
        options={{
          title: "Breach Check",
          tabBarLabel: "Breach",
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarLabel: "Settings",
        }}
      />
    </Tabs>
  );
}
