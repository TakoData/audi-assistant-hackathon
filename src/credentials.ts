import * as SecureStore from "expo-secure-store";

const API_KEY_NAME = "vw-assistant-answer-api-key";

export function loadApiKey() {
  return SecureStore.getItemAsync(API_KEY_NAME);
}

export function saveApiKey(apiKey: string) {
  return SecureStore.setItemAsync(API_KEY_NAME, apiKey.trim());
}

export function removeApiKey() {
  return SecureStore.deleteItemAsync(API_KEY_NAME);
}
