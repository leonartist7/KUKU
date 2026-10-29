import NotificationListener from "../src/NotificationListener";
import OutboxRunner from "../src/OutboxRunner";
import React from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator, StyleSheet } from "react-native";
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
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <OutboxRunner />
          <NotificationListener />
          <ThemedStack />
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function ThemedStack() {
  const { c } = useTheme();
  const { user } = useAuth();
  if (user === undefined) return <View style={styles.loading}><ActivityIndicator color={c.primary} /></View>;
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
            <Stack.Screen name="you" options={{animation: "slide_from_right"}} />
            <Stack.Screen name="appearance" options={{animation: "slide_from_right"}} />
            <Stack.Screen name="invite" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="privacy" />
            <Stack.Screen name="space/[id]" options={{presentation: "fullScreenModal", animation: "slide_from_bottom"}} />
            <Stack.Screen name="space/create" options={{presentation: "modal", animation: "slide_from_bottom"}} />
          </Stack.Protected>
        </Stack.Protected>
      </Stack>
    </CallProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
});
