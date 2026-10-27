import { CALLS_ENABLED } from "../../src/config";
import React, { useRef, useState } from "react";
import { Tabs } from "expo-router";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useTheme } from "../../src/ThemeContext";
import { Palette, radius } from "../../src/theme";
import RadialMenu, { RadialAction } from "../../src/RadialMenu";

type TabDef = {
  name: "index" | "files" | "calls" | "spaces";
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  testID: string;
};

const LEFT: TabDef[] = [
  { name: "index", label: "Home", icon: "chatbubble-ellipses-outline", testID: "tab-home" },
  { name: "files", label: "Files", icon: "folder-outline", testID: "tab-files" },
];
const RIGHT: TabDef[] = [
  { name: "calls", label: "Calls", icon: "call-outline", testID: "tab-calls" },
  { name: "spaces", label: "Spaces", icon: "planet-outline", testID: "tab-spaces" },
];

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="files" options={{ title: "Files" }} />
      <Tabs.Screen name="calls" options={{ title: "Calls" }} />
      <Tabs.Screen name="spaces" options={{ title: "Spaces" }} />
    </Tabs>
  );
}

function CustomTabBar({ state, navigation }: any) {
  const { c, f } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const styles = makeStyles(c);

  const currentRoute = state.routes[state.index].name;

  function nav(name: string) {
    const target = state.routes.find((r: any) => r.name === name);
    if (target) {
      const event = navigation.emit({
        type: "tabPress",
        target: target.key,
        canPreventDefault: true,
      });
      if (!event.defaultPrevented) {
        navigation.navigate(name);
      }
    }
  }

  const radialActions: RadialAction[] = [
    {
      key: "new-message",
      label: "New message",
      icon: "chatbubble-ellipses-outline",
      onPress: () => router.push("/new-message"),
    },
    {
      key: "share-file",
      label: "Send file",
      icon: "document-attach-outline",
      onPress: () => router.push("/new-message?mode=file"),
    },
    {
      key: "shared-space",
      label: "Shared space",
      icon: "sparkles-outline",
      onPress: () => router.push("/(tabs)/spaces"),
    },
  ];

  const renderTab = (t: TabDef) => {
    const active = currentRoute === t.name;
    return (
      <Pressable
        key={t.name}
        onPress={() => nav(t.name)}
        style={styles.tab}
        testID={t.testID}
      >
        <Ionicons
          name={t.icon}
          size={22}
          color={active ? c.primary : c.textSecondary}
        />
        <Text
          style={[
            styles.tabLabel,
            { color: active ? c.primary : c.textSecondary, fontFamily: f.bodyMedium },
          ]}
        >
          {t.label}
        </Text>
        {active ? <View style={[styles.dot, { backgroundColor: c.primary }]} /> : <View style={styles.dotHidden} />}
      </Pressable>
    );
  };

  return (
    <>
      <View
        style={[
          styles.bar,
          { paddingBottom: Math.max(insets.bottom, 10) },
        ]}
      >
        {LEFT.map(renderTab)}

        {/* Center + FAB */}
        <View style={styles.centerWrap}>
          <Pressable
            onPress={() => router.push("/new-message")}
            onLongPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              setMenuOpen(true);
            }}
            delayLongPress={220}
            style={({ pressed }) => [
              styles.fab,
              { backgroundColor: c.primary },
              pressed && { transform: [{ scale: 0.95 }] },
            ]}
            testID="quick-action-button"
          >
            <Ionicons name="add" size={28} color={c.textInverse} />
          </Pressable>
        </View>

        {RIGHT.filter(t => t.name !== "calls" || CALLS_ENABLED).map(renderTab)}
      </View>

      <RadialMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        actions={radialActions}
        anchor={undefined}
      />
    </>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "flex-start",
      backgroundColor: c.surface,
      paddingTop: 10,
      paddingHorizontal: 8,
      borderTopWidth: c.isDark ? 0 : 0,
      shadowColor: c.text,
      shadowOpacity: 0.05,
      shadowOffset: { width: 0, height: -4 },
      shadowRadius: 12,
      elevation: 8,
    },
    tab: {
      flex: 1,
      alignItems: "center",
      justifyContent: "flex-start",
      paddingTop: 6,
      gap: 2,
    },
    tabLabel: {
      fontSize: 11,
      letterSpacing: 0.3,
    },
    dot: {
      marginTop: 4,
      width: 4,
      height: 4,
      borderRadius: 2,
    },
    dotHidden: { marginTop: 4, width: 4, height: 4 },
    centerWrap: {
      width: 72,
      alignItems: "center",
      justifyContent: "center",
    },
    fab: {
      width: 58,
      height: 58,
      borderRadius: 29,
      alignItems: "center",
      justifyContent: "center",
      marginTop: Platform.OS === "ios" ? -18 : -22,
      shadowColor: "#3C352D",
      shadowOpacity: 0.2,
      shadowOffset: { width: 0, height: 6 },
      shadowRadius: 14,
      elevation: 8,
      borderWidth: 3,
      borderColor: c.bg,
    },
  });
