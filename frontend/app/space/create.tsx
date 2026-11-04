import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, getSessionUserId, User } from "../../src/api";
import { useAuth } from "../../src/AuthContext";
import { spacesApi } from "../../src/spaces";
import { useTheme } from "../../src/ThemeContext";
import { Palette, radius, spacing } from "../../src/theme";
import Avatar from "../../src/Avatar";

export default function CreateSpaceScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.id || "";
  const currentUid = useRef(uid); currentUid.current = uid;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { c, f } = useTheme();
  const styles = React.useMemo(() => makeStyles(c, f), [c, f]);
  const [name, setName] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [usersOwner, setUsersOwner] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => { setName(""); setSelected(new Set()); setCreateError(null); }, [uid]);

  useEffect(() => {
    let active = true;
    setUsers([]); setLoading(true); setError(null);
    if (!uid) { setLoading(false); return; }
    void api.getAs<User[]>(uid, "/users")
      .then(people => { if (active && currentUid.current === uid) { setUsers(people); setUsersOwner(uid); } })
      .catch(() => { if (active) setError("Couldn't load your contacts. Go back and try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uid, reload]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function create() {
    if (creating || !uid || usersOwner !== uid) return;
    setCreating(true);
    setCreateError(null);
    try {
      const space = await spacesApi.create(name.trim() || null, Array.from(selected), uid);
      if (mounted.current && currentUid.current === uid && getSessionUserId() === uid) router.replace(`/space/${space.id}`);
    } catch {
      if (mounted.current && currentUid.current === uid) setCreateError("Couldn't create the Space. Your choices are kept; try again.");
    } finally {
      if (mounted.current && currentUid.current === uid) setCreating(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="create-back">
          <Ionicons name="chevron-back" size={22} color={c.text} />
        </Pressable>
        <Text style={styles.title}>Create Space</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heroTitle}>Who&apos;s coming?</Text>
        <Text style={styles.heroBody}>Pick a few people. You can name the room if you want.</Text>

        <Text style={styles.sectionLabel}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Saturday Late Night"
          placeholderTextColor={c.textTertiary}
          style={styles.input}
          testID="space-name-input"
        />

        <Text style={styles.sectionLabel}>People</Text>
        {loading ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator color={c.primary} />
          </View>
        ) : error ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Retry loading contacts" onPress={() => setReload(value => value + 1)} style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
            <Text style={styles.errorText}>{error}</Text>
          </Pressable>
        ) : (
          <View style={styles.peopleList}>
            {(usersOwner === uid ? users : []).map((u) => {
              const on = selected.has(u.id);
              return (
                <Pressable
                  key={u.id}
                  onPress={() => toggle(u.id)}
                  style={({ pressed }) => [
                    styles.personRow,
                    on && { borderColor: c.primary, backgroundColor: c.primaryBgSubtle },
                    pressed && { opacity: 0.9 },
                  ]}
                  testID={`pick-${u.id}`}
                >
                  <Avatar name={u.name} seed={u.id} photo={u.avatar} size={42} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personName}>{u.name}</Text>
                    <Text style={styles.personEmail}>{u.email}</Text>
                  </View>
                  <View style={[styles.checkbox, on && { backgroundColor: c.primary, borderColor: c.primary }]}>
                    {on ? <Ionicons name="checkmark" size={14} color={c.textInverse} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {createError ? <Text accessibilityRole="alert" style={[styles.errorText, { color: c.error, marginBottom: 12 }]}>{createError}</Text> : null}
        <Pressable
          onPress={create}
          accessibilityRole="button"
          disabled={creating || loading || usersOwner !== uid || !!error}
          style={({ pressed }) => [
            styles.cta,
            pressed && { transform: [{ scale: 0.98 }] },
            creating && { opacity: 0.7 },
          ]}
          testID="create-space-submit"
        >
          {creating ? (
            <ActivityIndicator color={c.textInverse} />
          ) : (
            <Text style={styles.ctaText}>
              Enter Space
              {selected.size ? `  ·  ${selected.size + 1}` : ""}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette, f: any) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    backBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { fontFamily: f.heading, fontSize: 18, color: c.text },
    scroll: { padding: spacing.lg, paddingBottom: 100, width: "100%", maxWidth: 760, alignSelf: "center" },
    heroTitle: {
      fontFamily: f.heading,
      fontSize: 28,
      color: c.text,
      letterSpacing: -0.5,
      marginBottom: 6,
    },
    heroBody: { fontFamily: f.body, fontSize: 16, color: c.textSecondary, marginBottom: spacing.lg, lineHeight: 24 },
    sectionLabel: {
      fontFamily: f.bodyBold,
      fontSize: 11,
      color: c.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 1.3,
      marginBottom: spacing.sm,
      marginTop: spacing.sm,
    },
    input: {
      height: 52,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontFamily: f.body,
      fontSize: 15,
      color: c.text,
      marginBottom: spacing.md,
    },
    peopleList: { gap: spacing.sm },
    errorText: { fontFamily: f.body, fontSize: 14, color: c.textSecondary },
    personRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 2,
      borderColor: "transparent",
    },
    personName: { fontFamily: f.bodyBold, fontSize: 15, color: c.text },
    personEmail: { fontFamily: f.body, fontSize: 12, color: c.textSecondary, marginTop: 2 },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    footer: {
      padding: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.bg,
    },
    cta: {
      height: 54,
      borderRadius: radius.lg,
      backgroundColor: c.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    ctaText: { color: c.textInverse, fontFamily: f.bodyBold, fontSize: 16, letterSpacing: 0.2 },
  });
