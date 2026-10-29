import React from "react";
import {Modal, Pressable, View, Text, StyleSheet} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {Ionicons} from "@expo/vector-icons";
import {useTheme} from "./ThemeContext";
export type RadialAction = {key: string; label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void};
export default function RadialMenu({visible, onClose, actions}: {visible: boolean; onClose: () => void; actions: RadialAction[]; anchor?: {x: number; y: number}}) {
  const {c, f} = useTheme();
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
    <View style={{flex: 1, backgroundColor: c.overlay, justifyContent: "flex-end"}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss quick actions" style={StyleSheet.absoluteFill} onPress={onClose}/>
      <SafeAreaView edges={["bottom"]} style={{width: "100%", maxWidth: 540, alignSelf: "center", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, backgroundColor: c.bg}}>
        <View style={{flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12}}><Text accessibilityRole="header" style={{fontFamily: f.heading, fontSize: 23, color: c.text, flex: 1}}>A little something to share</Text><Pressable accessibilityRole="button" accessibilityLabel="Close quick actions" onPress={onClose} style={{minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center"}}><Ionicons name="close" size={22} color={c.text}/></Pressable></View>
        {actions.map(action => <Pressable key={action.key} accessibilityRole="button" accessibilityLabel={action.label} onPress={() => {onClose(); action.onPress();}} testID={`radial-${action.key}`} style={({pressed}) => ({flexDirection: "row", alignItems: "center", minHeight: 60, gap: 16, padding: 12, borderRadius: 16, backgroundColor: pressed ? c.surfaceElevated : c.surface, marginBottom: 8})}><Ionicons name={action.icon} size={24} color={c.primaryDark}/><Text style={{fontFamily: f.bodyMedium, color: c.text, fontSize: 16}}>{action.label}</Text></Pressable>)}
      </SafeAreaView>
    </View>
  </Modal>;
}
