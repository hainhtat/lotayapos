import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const memory = new Map<string, string>();

async function useSecureStore() {
  if (Platform.OS === "web") return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

function webGet(key: string) {
  try {
    if (typeof localStorage === "undefined") return memory.get(key) ?? null;
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function webSet(key: string, value: string) {
  try {
    if (typeof localStorage === "undefined") {
      memory.set(key, value);
      return;
    }
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

function webDelete(key: string) {
  try {
    if (typeof localStorage === "undefined") {
      memory.delete(key);
      return;
    }
    localStorage.removeItem(key);
  } catch {
    memory.delete(key);
  }
}

/** SecureStore on native; localStorage (or memory) on web / unavailable SecureStore. */
export async function kvGet(key: string): Promise<string | null> {
  if (await useSecureStore()) return SecureStore.getItemAsync(key);
  return webGet(key);
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (await useSecureStore()) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  webSet(key, value);
}

export async function kvDelete(key: string): Promise<void> {
  if (await useSecureStore()) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  webDelete(key);
}
