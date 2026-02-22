import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { scanInstalledApps, type AppScanResult, type RiskLevel } from "@/modules/app-scanner";
import { AppRiskCard } from "@/components/AppRiskCard";
import { PermissionEducationHub } from "@/components/PermissionEducationHub";
import { Button } from "@/components/Button";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

const RISK_ORDER: Record<RiskLevel, number> = { red: 0, yellow: 1, green: 2 };

export default function AppsScreen() {
  // On iOS, show the education hub instead
  if (Platform.OS === "ios") {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <PermissionEducationHub />
      </SafeAreaView>
    );
  }

  return <AndroidScanner />;
}

function AndroidScanner() {
  const [apps, setApps] = useState<AppScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [search, setSearch] = useState("");

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const results = await scanInstalledApps();
      // Sort by risk: red first, then yellow, then green
      results.sort(
        (a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel],
      );
      setApps(results);
      setHasScanned(true);
    } catch {
      setApps([]);
    } finally {
      setScanning(false);
    }
  }, []);

  const filtered = search.trim()
    ? apps.filter((a) =>
        a.appName.toLowerCase().includes(search.toLowerCase()),
      )
    : apps;

  const redCount = apps.filter((a) => a.riskLevel === "red").length;
  const yellowCount = apps.filter((a) => a.riskLevel === "yellow").length;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      {!hasScanned ? (
        <View style={styles.emptyState}>
          <Ionicons name="shield-outline" size={64} color={Colors.primary} />
          <Text style={styles.emptyTitle}>App Permission Scanner</Text>
          <Text style={styles.emptyDescription}>
            Scan your installed apps to find potentially dangerous permission
            combinations that could indicate malware or spyware.
          </Text>
          <View style={styles.buttonContainer}>
            <Button
              label={scanning ? "SCANNING..." : "SCAN APPS"}
              onPress={handleScan}
              disabled={scanning}
            />
          </View>
          <View style={styles.privacyBanner}>
            <Ionicons name="lock-closed" size={14} color={Colors.textSecondary} />
            <Text style={styles.privacyText}>
              Your app list stays on your device
            </Text>
          </View>
        </View>
      ) : (
        <>
          {/* Summary */}
          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              {apps.length} apps scanned
            </Text>
            {redCount > 0 && (
              <View style={[styles.summaryBadge, { backgroundColor: "#FEF2F2" }]}>
                <Text style={[styles.summaryBadgeText, { color: "#D32F2F" }]}>
                  {redCount} high risk
                </Text>
              </View>
            )}
            {yellowCount > 0 && (
              <View style={[styles.summaryBadge, { backgroundColor: "#FFF8E1" }]}>
                <Text style={[styles.summaryBadgeText, { color: "#F57C00" }]}>
                  {yellowCount} caution
                </Text>
              </View>
            )}
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search apps..."
              placeholderTextColor={Colors.textSecondary}
              value={search}
              onChangeText={setSearch}
            />
          </View>

          {/* App list */}
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.packageName}
            renderItem={({ item }) => <AppRiskCard app={item} />}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            refreshControl={
              <RefreshControl refreshing={scanning} onRefresh={handleScan} />
            }
            ListEmptyComponent={
              <Text style={styles.emptyList}>No apps found</Text>
            }
          />

          <View style={styles.privacyBannerBottom}>
            <Ionicons name="lock-closed" size={12} color={Colors.textSecondary} />
            <Text style={styles.privacyTextSmall}>
              Your app list never leaves your device
            </Text>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    padding: 32,
    gap: 16,
    alignItems: "center",
  },
  buttonContainer: {
    width: "100%",
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 24,
    fontFamily: Fonts.bold,
    color: Colors.navy,
    textAlign: "center",
  },
  emptyDescription: {
    fontSize: 15,
    fontFamily: Fonts.regular,
    color: Colors.text,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  privacyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  privacyText: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Colors.textSecondary,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  summaryText: {
    fontSize: 15,
    fontFamily: Fonts.semiBold,
    color: Colors.navy,
  },
  summaryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  summaryBadgeText: {
    fontSize: 12,
    fontFamily: Fonts.semiBold,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.white,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 15,
    fontFamily: Fonts.regular,
    color: Colors.text,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  emptyList: {
    textAlign: "center",
    fontSize: 15,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
    marginTop: 32,
  },
  privacyBannerBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  privacyTextSmall: {
    fontSize: 11,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
});
