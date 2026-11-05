import React, {useState} from "react";
import {Pressable, StyleSheet, Text, View} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import {useTheme} from "./ThemeContext";
import {layout, radius, spacing, typography} from "./theme";

type Icon = keyof typeof Ionicons.glyphMap;

export function ContentFrame({children, reading = false}: {children: React.ReactNode; reading?: boolean}) {
  return <View style={{flex: 1, width: "100%", maxWidth: reading ? layout.readingMaxWidth : layout.contentMaxWidth, alignSelf: "center"}}>{children}</View>;
}

export function IconButton({label, icon, onPress, testID, quiet = false}: {
  label: string; icon: Icon; onPress: () => void; testID?: string; quiet?: boolean;
}) {
  const {c} = useTheme(); const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID}
    onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({pressed}) => ({minWidth: layout.touchTarget, minHeight: layout.touchTarget, borderRadius: radius.md,
      borderWidth: 2, borderColor: focused ? c.primaryDark : "transparent", alignItems: "center", justifyContent: "center",
      backgroundColor: pressed ? c.primaryBgSubtle : quiet ? "transparent" : c.surface, opacity: pressed ? 0.85 : 1})}>
    <Ionicons name={icon} size={22} color={c.text}/>
  </Pressable>;
}

export function PageHeader({title, subtitle, leading, trailing}: {
  title: string; subtitle?: string; leading?: React.ReactNode; trailing?: React.ReactNode;
}) {
  const {c, f} = useTheme();
  return <View style={styles.header}>
    {leading}
    <View style={{flex: 1, minWidth: 0, gap: 3}}>
      <Text accessibilityRole="header" style={[typography.title, {fontFamily: f.heading, color: c.text}]}>{title}</Text>
      {subtitle ? <Text style={[typography.caption, {fontFamily: f.body, color: c.textSecondary}]}>{subtitle}</Text> : null}
    </View>
    {trailing}
  </View>;
}

export function ScreenState({icon = "chatbubbles-outline", title, detail, action, secondaryAction, error = false}: {
  icon?: Icon; title: string; detail: string; error?: boolean;
  action?: {label: string; onPress: () => void; testID?: string};
  secondaryAction?: {label: string; onPress: () => void};
}) {
  const {c, f} = useTheme();
  return <View style={styles.state}>
    <View style={[styles.stateIcon, {backgroundColor: error ? c.errorBg : c.primaryBgSubtle}]}><Ionicons name={icon} size={28} color={error ? c.error : c.primaryDark}/></View>
    <Text accessibilityRole={error ? "alert" : "header"} style={[typography.section, {fontFamily: f.heading, color: c.text, textAlign: "center"}]}>{title}</Text>
    <Text style={[typography.body, {fontFamily: f.body, color: c.textSecondary, textAlign: "center", maxWidth: 360}]}>{detail}</Text>
    {action ? <Pressable accessibilityRole="button" accessibilityLabel={action.label} testID={action.testID} onPress={action.onPress}
      style={({pressed}) => ({minHeight: layout.touchTarget, paddingVertical: 13, paddingHorizontal: 22, borderRadius: radius.md, backgroundColor: c.text, opacity: pressed ? 0.8 : 1, marginTop: 8, alignItems: "center", justifyContent: "center"})}>
      <Text style={[typography.caption, {fontFamily: f.bodyMedium, color: c.bg, textAlign: "center"}]}>{action.label}</Text>
    </Pressable> : null}
    {secondaryAction ? <Pressable accessibilityRole="button" accessibilityLabel={secondaryAction.label} onPress={secondaryAction.onPress}
      style={{minHeight: layout.touchTarget, justifyContent: "center", alignItems: "center", paddingHorizontal: 16}}>
      <Text style={[typography.caption, {fontFamily: f.bodyMedium, color: c.primaryDark}]}>{secondaryAction.label}</Text>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  header: {paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.lg, flexDirection: "row", alignItems: "center", gap: 16},
  state: {paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, alignItems: "center", gap: 12},
  stateIcon: {width: 64, height: 64, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 4},
});
