import NotificationListener from "../src/NotificationListener";
import MessageSoundListener from "../src/MessageSoundListener";
import ChatRealtimeProvider from "../src/ChatRealtimeProvider";
import OngoingCallBanner from "../src/OngoingCallBanner";
import OutboxRunner from "../src/OutboxRunner";
import React, {useEffect, useState} from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { View, Text, ActivityIndicator, StyleSheet, Platform } from "react-native";
import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_600SemiBold,
} from "@expo-google-fonts/fraunces";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
} from "@expo-google-fonts/dm-sans";
import { AuthProvider, useAuth } from "../src/AuthContext";
import { ThemeProvider, useTheme } from "../src/ThemeContext";
import { CallProvider } from "../src/CallContext";
import { colors } from "../src/theme";

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
  });

  const [fontFallback,setFontFallback]=useState(false);
  useEffect(()=>{
    if(fontsLoaded||fontError||Platform.OS!=="web")return;
    const timer=setTimeout(()=>setFontFallback(true),2500);
    return()=>clearTimeout(timer);
  },[fontsLoaded,fontError]);
  if (!fontsLoaded && !fontError && !fontFallback) return <StartupStatus/>;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <ChatRealtimeProvider>
          <OutboxRunner />
          <NotificationListener />
          <MessageSoundListener />
          <ThemedStack />
          </ChatRealtimeProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function ThemedStack() {
  const { c } = useTheme();
  const { user } = useAuth();
  if (user === undefined) return <StartupStatus color={c.primary} background={c.bg}/>;
  const verified = !!user?.email_verified;
  return (
    <CallProvider>
      <StatusBar style={c.isDark ? "light" : "dark"} />
      <Stack screenOptions={{headerShown: false, contentStyle: {backgroundColor: c.bg}, animation: "fade"}}>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="login" />
          <Stack.Screen name="recover" />
        </Stack.Protected>
        <Stack.Protected guard={!!user && !verified}>
          <Stack.Screen name="verify" />
        </Stack.Protected>
        <Stack.Protected guard={verified}>
          <Stack.Screen name="onboarding" />
          <Stack.Protected guard={user?.onboarding_complete !== false}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="chat/[id]" options={{animation: "slide_from_right"}} />
            <Stack.Screen name="call/[id]" options={{presentation: "fullScreenModal", animation: "fade"}} />
            <Stack.Screen name="new-message" options={{presentation: "transparentModal", animation: "slide_from_bottom"}} />
            <Stack.Screen name="account" options={{animation: "slide_from_right"}} />
            <Stack.Screen name="appearance" options={{animation: "slide_from_right"}} />
            <Stack.Screen name="invite" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="privacy" />
            <Stack.Screen name="credits" />
            <Stack.Screen name="space/[id]" options={{presentation: "fullScreenModal", animation: "slide_from_bottom"}} />
            <Stack.Screen name="space/create" options={{presentation: "modal", animation: "slide_from_bottom"}} />
          </Stack.Protected>
        </Stack.Protected>
      </Stack>
      <OngoingCallBanner />
    </CallProvider>
  );
}

function StartupStatus({color=colors.primary,background=colors.bg}:{color?:string;background?:string}){
  const [slow,setSlow]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(timer);},[]);
  return <View testID="startup-status" accessibilityLiveRegion="polite" style={[styles.loading,{backgroundColor:background,padding:32,gap:16}]}>
    <Text style={{fontSize:24,fontWeight:"600",letterSpacing:2,color}}>KUKU</Text>
    <ActivityIndicator color={color}/>
    <Text style={{fontSize:16,color,textAlign:"center"}}>{slow?"Still connecting to your space":"Opening your space"}</Text>
    <Text style={{fontSize:14,lineHeight:21,color,textAlign:"center",maxWidth:340}}>{slow?"Reconnecting can take a moment. Please keep this page open while we reconnect.":"A little closer, in a moment."}</Text>
  </View>;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
});
