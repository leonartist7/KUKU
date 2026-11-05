import {CALLS_ENABLED} from "../../src/config";
import React, {useState} from "react";
import {Tabs, useRouter} from "expo-router";
import {View, Text, Pressable, StyleSheet, Platform} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import {useTheme} from "../../src/ThemeContext";
import {layout, Palette, radius} from "../../src/theme";
import RadialMenu, {RadialAction} from "../../src/RadialMenu";

type TabDef = {
  name: "index" | "spaces" | "files" | "you"; label: string;
  icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap; testID: string;
};
const TABS: TabDef[] = [
  {name: "index", label: "Chats", icon: "chatbubble-ellipses-outline", activeIcon: "chatbubble-ellipses", testID: "tab-home"},
  {name: "spaces", label: "Spaces", icon: "planet-outline", activeIcon: "planet", testID: "tab-spaces"},
  {name: "files", label: "Files", icon: "folder-outline", activeIcon: "folder", testID: "tab-files"},
  {name: "you", label: "You", icon: "person-outline", activeIcon: "person", testID: "tab-you"},
];

export default function TabsLayout() {
  return <Tabs screenOptions={{headerShown: false, tabBarHideOnKeyboard: true}} tabBar={props => <CustomTabBar {...props}/>}>
    <Tabs.Screen name="index" options={{title: "Chats"}}/>
    <Tabs.Screen name="spaces" options={{title: "Spaces"}}/>
    <Tabs.Screen name="files" options={{title: "Files"}}/>
    <Tabs.Screen name="you" options={{title: "You"}}/>
    <Tabs.Screen name="calls" options={{title: "Calls", href: null}}/>
  </Tabs>;
}

function CustomTabBar({state, navigation}: any) {
  const {c, f} = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false); const [focused, setFocused] = useState<string | null>(null);
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const currentRoute = state.routes[state.index].name;
  function nav(name: string) {
    const target = state.routes.find((route: any) => route.name === name);
    if (!target) return;
    const event = navigation.emit({type: "tabPress", target: target.key, canPreventDefault: true});
    if (!event.defaultPrevented) navigation.navigate(name);
  }
  const radialActions: RadialAction[] = [
    {key: "new-message", label: "New message", icon: "chatbubble-ellipses-outline", onPress: () => router.push("/new-message")},
    {key: "share-file", label: "Upload a file", icon: "document-attach-outline", onPress: () => router.push("/new-message?mode=file")},
    {key: "share-photo", label: "Share a photo", icon: "image-outline", onPress: () => router.push("/new-message?mode=photo")},
    {key: "share-voice", label: "Voice memo", icon: "mic-outline", onPress: () => router.push("/new-message?mode=voice")},
    {key: "invite", label: "Invite someone", icon: "person-add-outline", onPress: () => router.push("/invite")},
    {key: "shared-space", label: "Shared space", icon: "sparkles-outline", onPress: () => nav("spaces")},
  ];
  if (CALLS_ENABLED) radialActions.push({key: "calls", label: "Call history", icon: "call-outline", onPress: () => router.push("/(tabs)/calls")});
  const renderTab = (tab: TabDef) => {
    const active = currentRoute === tab.name;
    return <Pressable key={tab.name} accessibilityRole="tab" accessibilityLabel={tab.label}
      accessibilityState={{selected: active}} testID={tab.testID} onPress={() => nav(tab.name)}
      onFocus={() => setFocused(tab.name)} onBlur={() => setFocused(null)}
      style={({pressed}) => [styles.tab, {backgroundColor: active || pressed ? c.primaryBgSubtle : "transparent", borderColor: focused === tab.name ? c.primaryDark : "transparent"}]}>
      <Ionicons name={active ? tab.activeIcon : tab.icon} size={22} color={active ? c.primaryDark : c.textSecondary}/>
      <Text style={{fontFamily: active ? f.bodyBold : f.bodyMedium, color: active ? c.text : c.textSecondary, fontSize: 12, lineHeight: 17, textAlign: "center"}}>{tab.label}</Text>
    </Pressable>;
  };
  return <>
    <View style={[styles.bar, {paddingBottom: Math.max(insets.bottom, 8)}]}><View style={styles.barInner}>
      {TABS.slice(0, 2).map(renderTab)}
      <View style={styles.createWrap}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open quick actions" accessibilityState={{expanded: menuOpen}}
          onFocus={() => setFocused("actions")} onBlur={() => setFocused(null)} onPress={() => setMenuOpen(true)}
          onLongPress={() => {if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => {}); setMenuOpen(true);}}
          delayLongPress={220} testID="quick-action-button"
          style={({pressed}) => [styles.create, {backgroundColor: c.text, opacity: pressed ? 0.8 : 1, borderColor: focused === "actions" ? c.primary : c.text}]}>
          <Ionicons name="add" size={27} color={c.bg}/>
        </Pressable>
      </View>
      {TABS.slice(2).map(renderTab)}
    </View></View>
    <RadialMenu visible={menuOpen} onClose={() => setMenuOpen(false)} actions={radialActions} anchor={undefined}/>
  </>;
}
const makeStyles = (c: Palette) => StyleSheet.create({
  bar: {backgroundColor: c.bg, paddingTop: 8, paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border},
  barInner: {width: "100%", maxWidth: layout.contentMaxWidth, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 2},
  tab: {flex: 1, minWidth: layout.touchTarget, minHeight: 58, paddingHorizontal: 2, paddingVertical: 6, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 2, gap: 3},
  createWrap: {width: 56, alignItems: "center", justifyContent: "center"},
  create: {width: layout.touchTarget, height: layout.touchTarget, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 2},
});
