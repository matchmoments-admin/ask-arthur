import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking } from "react-native";
import { Cross, ChevronUp, ChevronDown } from "lucide-react-native";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";
import type { Verdict } from "@askarthur/types";

interface RecoveryItem {
  text: string;
  contact?: string;
  contactLabel?: string;
}

interface RecoverySection {
  title: string;
  items: RecoveryItem[];
}

interface RecoveryGuideProps {
  verdict: Verdict;
  scamType?: string;
  impersonatedBrand?: string;
}

const IMMEDIATE_ACTIONS: RecoverySection = {
  title: "Immediate Actions",
  items: [
    { text: "Stop all communication with the sender immediately" },
    { text: "Do not click any links or download attachments" },
    { text: "If you shared financial details, contact your bank's fraud team now" },
    { text: "Take screenshots of the message as evidence" },
  ],
};

const REPORT_SCAM_AU: RecoverySection = {
  title: "Report the Scam",
  items: [
    { text: "Report to Scamwatch (ACCC)", contactLabel: "1300 795 995", contact: "https://www.scamwatch.gov.au/report-a-scam" },
    { text: "Report to ReportCyber (ACSC)", contactLabel: "1300 292 371", contact: "https://www.cyber.gov.au/report-and-recover/report" },
    { text: "Contact IDCARE for identity theft support", contactLabel: "1800 595 160" },
  ],
};

const PROTECT_ACCOUNTS: RecoverySection = {
  title: "Protect Your Accounts",
  items: [
    { text: "Change passwords on any compromised accounts" },
    { text: "Enable two-factor authentication (2FA)" },
    { text: "Monitor bank statements for unauthorised transactions" },
  ],
};

const GET_SUPPORT: RecoverySection = {
  title: "Get Support",
  items: [
    { text: "Lifeline \u2014 24/7 crisis support", contactLabel: "13 11 14" },
    { text: "Beyond Blue \u2014 mental health support", contactLabel: "1300 22 4636" },
  ],
};

const SCAM_TYPE_SECTIONS: Record<string, RecoverySection> = {
  investment: {
    title: "Investment Scam Recovery",
    items: [
      { text: "Report to ASIC", contactLabel: "1300 300 630" },
      { text: "Do not invest any more money" },
    ],
  },
  romance: {
    title: "Romance Scam Recovery",
    items: [
      { text: "Stop sending money \u2014 promises are part of the scam" },
      { text: "Report the fake profile to the platform" },
    ],
  },
  "tech-support": {
    title: "Tech Support Scam Recovery",
    items: [
      { text: "Uninstall any remote access software" },
      { text: "Run a full antivirus scan" },
      { text: "Change all passwords from a clean device" },
    ],
  },
  phishing: {
    title: "Phishing Recovery",
    items: [
      { text: "Change the password on any affected account" },
      { text: "Enable 2FA on the compromised account" },
    ],
  },
};

function buildSections(scamType?: string, impersonatedBrand?: string): RecoverySection[] {
  const sections: RecoverySection[] = [IMMEDIATE_ACTIONS];

  if (scamType) {
    const normalised = scamType.toLowerCase().replace(/[\s_]/g, "-");
    const extra = SCAM_TYPE_SECTIONS[normalised];
    if (extra) sections.push(extra);
  }

  sections.push(REPORT_SCAM_AU, PROTECT_ACCOUNTS, GET_SUPPORT);
  return sections;
}

export function RecoveryGuide({ verdict, scamType, impersonatedBrand }: RecoveryGuideProps) {
  const [expanded, setExpanded] = useState(verdict === "HIGH_RISK");

  if (verdict === "SAFE") return null;

  const sections = buildSections(scamType, impersonatedBrand);

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={styles.headerLeft}>
          <Cross size={18} color={Colors.navy} />
          <Text style={styles.headerTitle}>Recovery Guidance</Text>
        </View>
        {expanded ? (
          <ChevronUp size={18} color={Colors.textSecondary} />
        ) : (
          <ChevronDown size={18} color={Colors.textSecondary} />
        )}
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          {sections.map((section, i) => (
            <View key={i} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.items.map((item, j) => (
                <View key={j} style={styles.item}>
                  <Text style={styles.bullet}>{"\u2022"}</Text>
                  <View style={styles.itemContent}>
                    <Text style={styles.itemText}>{item.text}</Text>
                    {item.contactLabel && (
                      <Pressable
                        onPress={() => Linking.openURL(`tel:${item.contactLabel!.replace(/\s/g, "")}`)}
                      >
                        <Text style={styles.contactLabel}>{item.contactLabel}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Colors.navy,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  body: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Colors.navy,
  },
  item: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 4,
  },
  bullet: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  itemContent: {
    flex: 1,
  },
  itemText: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: Fonts.regular,
    color: Colors.text,
  },
  contactLabel: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Colors.primary,
    marginTop: 2,
  },
});
