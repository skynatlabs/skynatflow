// The one screen this Phase 6 scaffold ships: today's deliveries, and a
// one-tap "Mark Delivered" that triggers the same money-engine link the
// strategic report describes (Section 9) — completing a delivery
// auto-generates the invoice on the server side.

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { completeDelivery, Delivery, fetchDeliveries } from "./api";

// Hardcoded until the field app has real per-driver login — swap for a
// value read from secure storage after auth lands (Phase 0 checkpoint).
const DEMO_TENANT_ID = "";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

export default function DeliveriesScreen() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!DEMO_TENANT_ID) {
      setError("Set DEMO_TENANT_ID in src/DeliveriesScreen.tsx to a real tenant id to test.");
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const data = await fetchDeliveries(DEMO_TENANT_ID);
      setDeliveries(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deliveries");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleComplete(d: Delivery) {
    setCompletingId(d.quoteId);
    try {
      await completeDelivery({
        tenantId: DEMO_TENANT_ID,
        partyId: d.partyId,
        quoteId: d.quoteId,
      });
      setDeliveries((prev) => prev.filter((x) => x.quoteId !== d.quoteId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark delivered");
    } finally {
      setCompletingId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Today&apos;s deliveries</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={deliveries}
        keyExtractor={(item) => item.quoteId}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        ListEmptyComponent={
          !error ? <Text style={styles.empty}>Nothing left to deliver today.</Text> : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.customer}>{item.customerName}</Text>
              <Text style={styles.amount}>{money(item.amountCents)}</Text>
            </View>
            <TouchableOpacity
              style={styles.button}
              disabled={completingId === item.quoteId}
              onPress={() => handleComplete(item)}
            >
              <Text style={styles.buttonText}>
                {completingId === item.quoteId ? "Saving..." : "Mark Delivered"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#05070a", paddingTop: 60, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#05070a" },
  title: { fontSize: 22, fontWeight: "700", color: "#eef2f1", marginBottom: 12 },
  error: { color: "#ff8080", marginBottom: 12 },
  empty: { color: "#8a97a3", marginTop: 24, textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  customer: { color: "#eef2f1", fontSize: 16, fontWeight: "600" },
  amount: { color: "#8a97a3", marginTop: 2 },
  button: { backgroundColor: "#14e0b4", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  buttonText: { color: "#05070a", fontWeight: "700", fontSize: 12 },
});
