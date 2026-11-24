import { Alert, Platform } from "react-native";

/**
 * Cross-platform confirmation dialog.
 * Uses native Alert.alert on iOS/Android and window.confirm on Web
 * (where React Native Web's multi-button Alert.alert is a no-op).
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.message
 * @param {string} [options.confirmText="OK"]
 * @param {string} [options.cancelText="Cancel"]
 * @param {boolean} [options.destructive=false]
 * @returns {Promise<boolean>} Resolves true if confirmed, false if cancelled.
 */
export function confirmDialog({
  title,
  message,
  confirmText = "OK",
  cancelText = "Cancel",
  destructive = false,
}) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const promptText =
        title && message ? `${title}\n\n${message}` : title || message || "";
      return Promise.resolve(Boolean(window.confirm(promptText)));
    }
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        {
          text: cancelText,
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: confirmText,
          style: destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      }
    );
  });
}

/**
 * Cross-platform informational alert (single acknowledgement button).
 *
 * @param {string} title
 * @param {string} [message]
 */
export function alertDialog(title, message) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      const promptText =
        title && message ? `${title}\n\n${message}` : title || message || "";
      window.alert(promptText);
    }
    return;
  }

  Alert.alert(title, message, [{ text: "OK" }]);
}
