import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../src/AuthContext";
import { useTheme } from "../src/ThemeContext";
import { Palette, radius, spacing } from "../src/theme";

export default function Login() {
  const router = useRouter();
  const { signIn, signUp } = useAuth();
  const { c, f } = useTheme();
  const styles = makeStyles(c, f);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
      } else {
        if (!name.trim()) throw new Error("Please enter your name");
        await signUp(email.trim(), password, name.trim(), invite.trim());
      }
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandWrap}>
            <View style={styles.brandDot} />
            <Text style={styles.brand}>KUKU</Text>
          </View>

          <Text style={styles.headline}>
            {mode === "signin" ? "Welcome back." : "Make space for the\nones who matter."}
          </Text>
          <Text style={styles.sub}>
            {mode === "signin"
              ? "A quieter place for the conversations you care about."
              : "Create your account with an invitation."}
          </Text>

          <View style={styles.form}>
            {mode === "signup" && (
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={c.textTertiary}
                style={styles.input}
                autoCapitalize="words"
                testID="name-input"
              />
            )}
            {mode === "signup" ? <TextInput
              value={invite} onChangeText={setInvite} placeholder="Invitation code"
              autoCapitalize="none" autoCorrect={false} style={styles.input}
              placeholderTextColor={c.textTertiary} accessibilityLabel="Invitation code" testID="invite-input"
            /> : null}
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              testID="email-input"
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={mode === "signup" ? "Password (12+ characters)" : "Password"}
              placeholderTextColor={c.textTertiary}
              secureTextEntry
              style={styles.input}
              testID="password-input"
            />

            {error ? (
              <Text style={styles.error} testID="auth-error">
                {error}
              </Text>
            ) : null}

            <Pressable
              onPress={submit}
              disabled={loading}
              style={({ pressed }) => [
                styles.cta,
                pressed && { transform: [{ scale: 0.98 }], opacity: 0.95 },
                loading && { opacity: 0.7 },
              ]}
              testID="auth-submit"
            >
              {loading ? (
                <ActivityIndicator color={c.textInverse} />
              ) : (
                <Text style={styles.ctaText}>
                  {mode === "signin" ? "Sign in" : "Create account"}
                </Text>
              )}
            </Pressable>

            {mode === "signin" ? <Pressable onPress={() => router.push("/recover")} style={styles.switch}><Text style={styles.switchText}>Forgot password?</Text></Pressable> : null}
            <Pressable
              onPress={() => {
                setError(null);
                setMode(mode === "signin" ? "signup" : "signin");
              }}
              style={styles.switch}
              testID="auth-switch"
            >
              <Text style={styles.switchText}>
                {mode === "signin"
                  ? "New here?  Create account"
                  : "Already have an account?  Sign in"}
              </Text>
            </Pressable>
          </View>


        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette, f: any) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  brandWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: c.primary,
  },
  brand: {
    fontFamily: f.heading,
    fontSize: 18,
    color: c.text,
    letterSpacing: 0.5,
  },
  headline: {
    fontFamily: f.heading,
    fontSize: 34,
    lineHeight: 40,
    color: c.text,
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
  },
  sub: {
    fontFamily: f.body,
    fontSize: 16,
    color: c.textSecondary,
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  form: { gap: spacing.sm + 4 },
  input: {
    height: 56,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontFamily: f.body,
    fontSize: 16,
    color: c.text,
  },
  cta: {
    height: 56,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  ctaText: {
    color: c.textInverse,
    fontFamily: f.bodyBold,
    fontSize: 16,
    letterSpacing: 0.2,
  },
  switch: {
    alignSelf: "center",
    paddingVertical: spacing.md,
  },
  switchText: {
    color: c.textSecondary,
    fontFamily: f.bodyMedium,
    fontSize: 14,
  },
  error: {
    color: c.error,
    fontFamily: f.bodyMedium,
    fontSize: 14,
    paddingHorizontal: spacing.xs,
  },
  demoHint: {
    marginTop: spacing.xl,
    backgroundColor: c.primaryBgSubtle,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  demoTitle: {
    fontFamily: f.bodyBold,
    fontSize: 13,
    color: c.primaryDark,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  demoText: {
    fontFamily: f.body,
    fontSize: 13,
    color: c.textSecondary,
    lineHeight: 20,
  },
});
