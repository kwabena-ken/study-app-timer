// Jest setup — runs before each test file (see "jest.setupFiles" in package.json).
//
// Replace AsyncStorage with the official in-memory mock so storage tests exercise
// real read/modify/write behavior without a native module. Individual tests call
// AsyncStorage.clear() in beforeEach to stay isolated.
// Polyfill fs.realpathSync.native on Windows Node 24 where it can fail with EPERM
const fs = require("fs");
if (fs.realpathSync && fs.realpathSync.native) {
  fs.realpathSync.native = fs.realpathSync;
}

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const { View } = require("react-native");
  const SafeAreaView = ({ children, ...props }) =>
    React.createElement(View, props, children);
  return {
    SafeAreaProvider: ({ children, ...props }) =>
      React.createElement(View, props, children),
    SafeAreaConsumer: ({ children }) =>
      children({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaView,
    useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
    initialWindowMetrics: {
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
      frame: { x: 0, y: 0, width: 390, height: 844 },
    },
  };
});
