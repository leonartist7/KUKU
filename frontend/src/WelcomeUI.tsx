import React, {useEffect, useRef, useState} from "react";
import {AccessibilityInfo, ActivityIndicator, Animated, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, useWindowDimensions, View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {Ionicons} from "@expo/vector-icons";
import {useTheme} from "./ThemeContext";

export const artwork = {birds: require("../assets/images/kuku-brand.png"), mail: require("../assets/images/kuku-mail.png")};

export function WelcomeShell({children, step, title, subtitle, image = "birds", back, backLabel = "Back", compact = false}: {
  children: React.ReactNode; step?: number; title: string; subtitle: string;
  image?: keyof typeof artwork; back?: () => void; backLabel?: string; compact?: boolean;
}) {
  const {c, f} = useTheme(); const {width} = useWindowDimensions(); const wide = width >= 960;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (!reduce && mounted) {opacity.setValue(0); Animated.timing(opacity, {toValue: 1, duration: 240, useNativeDriver: true}).start();}
    });
    return () => {mounted = false; opacity.stopAnimation();};
  }, [opacity]);
  return <SafeAreaView style={{flex: 1, backgroundColor: c.bg}} edges={["top", "bottom"]}>
    <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[ui.page, {paddingHorizontal: width < 380 ? 20 : 28, justifyContent: wide ? "center" : "flex-start"}]}>
        <View style={[ui.layout, wide && {flexDirection: "row", gap: 88, alignItems: "center"}]}>
          {wide ? <View style={{flex: 1, maxWidth: 440, paddingVertical: 36}}>
            <View style={ui.brand}><Image source={artwork.birds} style={ui.brandIcon}/><Text style={{fontFamily: f.heading, fontSize: 25, color: c.text}}>KUKU</Text></View>
            <Image source={artwork.birds} style={{width: "100%", height: 280, borderRadius: 140, marginVertical: 20}} resizeMode="contain" accessible={false}/>
            <Text style={{fontFamily: f.heading, fontSize: 42, lineHeight: 49, letterSpacing: -1.2, color: c.text}}>A little closer,{"\n"}even from afar.</Text>
            <Text style={{fontFamily: f.body, fontSize: 16, lineHeight: 25, color: c.textSecondary, marginTop: 18, maxWidth: 330}}>The everyday stories, little updates, and familiar people that make a place feel like home.</Text>
            <View style={{flexDirection: "row", gap: 8, alignItems: "center", marginTop: 28}}><Ionicons name="people-outline" size={16} color={c.primaryDark}/><Text style={{fontFamily: f.bodyMedium, fontSize: 12, color: c.textSecondary}}>Your people. Your own little corner.</Text></View>
          </View> : null}
          <Animated.View style={{width: "100%", maxWidth: 440, flexShrink: 1, opacity}}>
            <View style={[ui.brand, {justifyContent: back ? "space-between" : "flex-start", marginBottom: 24}]}>
              {back ? <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={back} style={ui.back}><Ionicons name="arrow-back" size={18} color={c.text}/><Text style={{fontFamily: f.bodyMedium, color: c.text, fontSize: 13}}>{backLabel}</Text></Pressable> : <View style={ui.brand}><Image source={artwork.birds} style={ui.brandIcon}/><Text style={{fontFamily: f.heading, fontSize: 21, color: c.text}}>KUKU</Text></View>}
              {step ? <Text style={{fontFamily: f.bodyMedium, color: c.textSecondary, fontSize: 12}}>A few little steps</Text> : null}
            </View>
            {step ? <View style={{flexDirection: "row", gap: 8, marginBottom: 24}} accessibilityLabel={"Step " + step + " of 3: " + ["Join", "Verify", "Profile"][step - 1]}>
              {["Join", "Verify", "Profile"].map((label, i) => <View key={label} style={{flex: 1, gap: 8}}><View style={{height: 3, borderRadius: 2, backgroundColor: i < step ? c.primaryDark : c.border}}/><Text style={{fontFamily: f.bodyMedium, fontSize: 11, color: i + 1 === step ? c.text : c.textSecondary}}>{i + 1 < step ? "✓ " : ""}{label}</Text></View>)}
            </View> : null}
            {!wide || image === "mail" ? <Image source={artwork[image]} resizeMode="contain" style={{height: compact ? 108 : 164, width: "100%", marginBottom: 12, borderRadius: 24}} accessible={false}/> : null}
            <Text accessibilityRole="header" style={{fontFamily: f.heading, fontSize: width < 380 ? 31 : 36, lineHeight: 42, letterSpacing: -0.9, color: c.text, marginBottom: 10}}>{title}</Text>
            <Text style={{fontFamily: f.body, fontSize: 15, lineHeight: 23, color: c.textSecondary, marginBottom: 25}}>{subtitle}</Text>
            <View style={{gap: 17}}>{children}</View>
          </Animated.View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function Field({label, hint, password = false, ...props}: TextInputProps & {label: string; hint?: string; password?: boolean}) {
  const {c, f} = useTheme(); const [focus, setFocus] = useState(false); const [visible, setVisible] = useState(false);
  return <View style={{gap: 7}}>
    <Text style={{fontFamily: f.bodyMedium, fontSize: 13, color: c.text}}>{label}</Text>
    <View style={{flexDirection: "row", alignItems: "center", borderRadius: 15, borderWidth: 1.5, borderColor: focus ? c.primaryDark : c.border, backgroundColor: c.surface}}>
      <TextInput {...props} accessibilityLabel={label} secureTextEntry={password && !visible} placeholderTextColor={c.textSecondary}
        onFocus={e => {setFocus(true); props.onFocus?.(e);}} onBlur={e => {setFocus(false); props.onBlur?.(e);}}
        style={[{flex: 1, minWidth: 0, minHeight: props.multiline ? 96 : 54, paddingHorizontal: 15, paddingVertical: 14, color: c.text, fontFamily: f.body, fontSize: 16, textAlignVertical: props.multiline ? "top" : "center"}, props.style]}/>
      {password ? <Pressable accessibilityRole="button" accessibilityLabel={visible ? "Hide password" : "Show password"} onPress={() => setVisible(!visible)} style={{width: 48, minHeight: 52, alignItems: "center", justifyContent: "center"}}><Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={20} color={c.textSecondary}/></Pressable> : null}
    </View>
    {hint ? <Text style={{fontFamily: f.body, fontSize: 12, lineHeight: 18, color: c.textSecondary}}>{hint}</Text> : null}
  </View>;
}

export function Action({label, onPress, busy = false, disabled = false, secondary = false, icon = "arrow-forward", testID}: {label: string; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean; icon?: keyof typeof Ionicons.glyphMap; testID?: string}) {
  const {c, f} = useTheme();
  return <Pressable testID={testID} onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: disabled || busy, busy}}
    style={({pressed}) => ({minHeight: 54, borderRadius: 16, paddingHorizontal: 18, flexDirection: "row", gap: 12, justifyContent: "center", alignItems: "center", backgroundColor: secondary ? c.surface : c.text, opacity: disabled || busy ? 0.55 : pressed ? 0.82 : 1, transform: [{scale: pressed ? 0.99 : 1}]})}>
    {busy ? <ActivityIndicator color={secondary ? c.text : c.bg}/> : <><Text style={{fontFamily: f.bodyMedium, fontSize: 15, color: secondary ? c.text : c.bg}}>{label}</Text><Ionicons name={icon} size={18} color={secondary ? c.text : c.bg}/></>}
  </Pressable>;
}

export function TextAction({label, onPress, disabled = false, testID}: {label: string; onPress: () => void; disabled?: boolean; testID?: string}) {
  const {c, f} = useTheme();
  return <Pressable testID={testID} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} style={{minHeight: 44, justifyContent: "center", alignItems: "center", opacity: disabled ? 0.5 : 1}}><Text style={{fontFamily: f.bodyMedium, color: c.primaryDark, fontSize: 13, textAlign: "center"}}>{label}</Text></Pressable>;
}
export function Notice({message, success = false}: {message: string; success?: boolean}) {
  const {c, f} = useTheme(); if (!message) return null;
  return <View style={{padding: 14, borderRadius: 13, backgroundColor: success ? c.primaryBgSubtle : c.errorBg, flexDirection: "row", gap: 9, alignItems: "flex-start"}}>
    <Ionicons name={success ? "checkmark-circle-outline" : "alert-circle-outline"} size={18} color={success ? c.primaryDark : c.error}/>
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{flex: 1, fontFamily: f.body, fontSize: 13, lineHeight: 20, color: c.text}}>{message}</Text>
  </View>;
}
export function GentleNote({children}: {children: React.ReactNode}) {
  const {c, f} = useTheme(); return <Text style={{fontFamily: f.body, fontSize: 12, lineHeight: 19, color: c.textSecondary, textAlign: "center"}}>{children}</Text>;
}
const ui = StyleSheet.create({
  page: {flexGrow: 1, paddingTop: 24, paddingBottom: 40, alignItems: "center"},
  layout: {width: "100%", maxWidth: 1060, alignItems: "center"},
  brand: {flexDirection: "row", gap: 9, alignItems: "center"},
  brandIcon: {width: 42, height: 42, borderRadius: 14},
  back: {minHeight: 44, flexDirection: "row", gap: 8, alignItems: "center", paddingRight: 14},
});
