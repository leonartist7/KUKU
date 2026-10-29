import React from "react";
import {View, StyleSheet} from "react-native";
import {Ionicons} from "@expo/vector-icons";
import {useTheme} from "./ThemeContext";
export default function Decor() {
  const {c, decor} = useTheme();
  if (decor === "plain") return null;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, {overflow: "hidden"}]}>
    {Array.from({length: 32}, (_, i) => <View key={i} style={{position: "absolute", left: `${(i * 29 + 4) % 96}%`, top: `${(i * 17 + 3) % 97}%`, opacity: c.isDark ? 0.12 : 0.10, transform: [{rotate: `${i * 37}deg`}]}}>
      {decor === "leaves" ? <Ionicons name="leaf-outline" size={24} color={c.primaryDark}/> : <View style={{width: decor === "dots" ? 4 : 40, height: decor === "dots" ? 4 : 40, borderRadius: 24, backgroundColor: decor === "dots" ? c.primaryDark : "transparent", borderWidth: decor === "orbits" ? 1 : 0, borderColor: c.primaryDark}}/>}
    </View>)}
  </View>;
}
