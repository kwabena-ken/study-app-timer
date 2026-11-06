# Test Infrastructure & E2E Test Suite Architecture

## Overview
This document defines the opaque-box end-to-end (E2E) testing infrastructure for the Study Timer application. The E2E test suite validates the 15 core architectural features (F1 through F15) specified in `PROJECT.md` and derived from `ORIGINAL_REQUEST.md`, spanning background timer reconciliation, Android back navigation, safe-area insets, save failure recovery, storage security, and build hardening.

## Test Runner & Execution
Tests are executed via Jest with Expo presets and Node.js polyfills configured in `jest-preload.js` and `jest.setup.js`:

```bash
# Run all E2E test suites
node -r ./jest-preload.js ./node_modules/jest/bin/jest.js e2e/

# Run specific E2E tiers
node -r ./jest-preload.js ./node_modules/jest/bin/jest.js e2e/__tests__/tier1_featureCoverage.test.js
node -r ./jest-preload.js ./node_modules/jest/bin/jest.js e2e/__tests__/tier2_boundaryCorners.test.js
node -r ./jest-preload.js ./node_modules/jest/bin/jest.js e2e/__tests__/tier3_crossFeaturePairwise.test.js
node -r ./jest-preload.js ./node_modules/jest/bin/jest.js e2e/__tests__/tier4_realWorldWorkloads.test.js

# Run the complete test suite (unit + integration + E2E)
npm test
```

## E2E Test Tiers
The E2E test suite is partitioned into four progressive tiers totaling 174 test cases (exceeding the >= 173 threshold):

| Tier | Suite File | Scope & Methodology | Count | Minimum Req |
|------|------------|---------------------|-------|-------------|
| **Tier 1** | `e2e/__tests__/tier1_featureCoverage.test.js` | Direct requirement and functional coverage (>=5 test cases per feature for F1 through F15) | 75 | 75 (5 × 15) |
| **Tier 2** | `e2e/__tests__/tier2_boundaryCorners.test.js` | Boundary conditions, edge values, negative inputs, and stress conditions (>=5 per feature) | 75 | 75 (5 × 15) |
| **Tier 3** | `e2e/__tests__/tier3_crossFeaturePairwise.test.js` | Cross-feature pairwise interactions across major architectural modules | 16 | 15 |
| **Tier 4** | `e2e/__tests__/tier4_realWorldWorkloads.test.js` | Realistic end-to-end user workflows, sleep/resume cycles, recovery, and persistence | 8 | 8 |
| **Total** | | | **174** | **173** |

## Feature Mapping (F1 - F15)

| Feature | Name | Primary Code Module | Specification Source | E2E Test Coverage |
|---------|------|---------------------|----------------------|-------------------|
| **F1** | AppState Active Reconciliation | `src/screens/SessionScreen.js`, `src/utils/sessionTimeline.js` | ORIGINAL_REQUEST §R1 | T1 (5), T2 (5), T3 (3), T4 (3) |
| **F2** | Background Study Time Crediting | `src/screens/SessionScreen.js`, `src/utils/sessionTimeline.js` | ORIGINAL_REQUEST §R1 | T1 (5), T2 (5), T3 (2), T4 (3) |
| **F3** | Clean Reconciliation Branching | `src/screens/SessionScreen.js`, `src/utils/sessionTimeline.js` | ORIGINAL_REQUEST §R1 | T1 (5), T2 (5), T3 (2), T4 (2) |
| **F4** | Hardware Back Button in SessionScreen | `src/screens/SessionScreen.js` | ORIGINAL_REQUEST §R1 | T1 (5), T2 (5), T3 (3), T4 (1) |
| **F5** | Screen Hierarchy Back Navigation | `App.js` | ORIGINAL_REQUEST §R1 | T1 (5), T2 (5), T3 (2), T4 (2) |
| **F6** | Startup Notification Cleanup | `App.js`, `src/hooks/useNotifications.js` | ORIGINAL_REQUEST §R1 | T1 (5), T2 (5), T3 (1), T4 (1) |
| **F7** | SafeAreaView Migration | `src/screens/*` (5 core screens) | ORIGINAL_REQUEST §R2 | T1 (5), T2 (5), T3 (2), T4 (1) |
| **F8** | DoneScreen Save Failure Recovery | `src/screens/DoneScreen.js` | ORIGINAL_REQUEST §R2 | T1 (5), T2 (5), T3 (2), T4 (1) |
| **F9** | HistoryScreen Subject Auto-Registration | `src/screens/HistoryScreen.js`, `src/utils/storage.js` | ORIGINAL_REQUEST §R2 | T1 (5), T2 (5), T3 (3), T4 (1) |
| **F10** | Settings Sanitization & Normalization | `src/utils/storage.js` | ORIGINAL_REQUEST §R3 | T1 (5), T2 (5), T3 (3), T4 (1) |
| **F11** | Session Update Whitelisting & Caps | `src/utils/storage.js` | ORIGINAL_REQUEST §R3 | T1 (5), T2 (5), T3 (3), T4 (1) |
| **F12** | Duplicate Template Label Cap | `src/utils/storage.js` | ORIGINAL_REQUEST §R3 | T1 (5), T2 (5), T3 (1), T4 (1) |
| **F13** | Android Permissions & Security Config | `app.json` | ORIGINAL_REQUEST §R3 | T1 (5), T2 (5), T3 (1), T4 (1) |
| **F14** | Standalone APK Build Configuration | `eas.json` | ORIGINAL_REQUEST §R3 | T1 (5), T2 (5), T3 (1), T4 (1) |
| **F15** | Security & Artifact Exclusions | `.gitignore` | ORIGINAL_REQUEST §R3 | T1 (5), T2 (5), T3 (1), T4 (1) |

## Test Environment & Isolation Strategy
- **Isolation**: Each test file operates in an isolated Jest runner worker. In-memory state and mock registries are cleared before each test case (`beforeEach`).
- **AsyncStorage Mock**: Provided by `@react-native-async-storage/async-storage/jest/async-storage-mock`, configured in `jest.setup.js`.
- **Safe Area Context**: Polyfilled via `react-native-safe-area-context` mock in `jest.setup.js` returning predictable geometry and zero insets default.
- **Node Polyfills**: `fs.realpathSync.native` polyfilled in `jest-preload.js` to ensure compatibility across Windows environments and Node 24.
- **Opaque-Box Verification**: Tests assert observable outcomes (rendered output, callback invocations, persisted storage JSON, navigation state transitions, exit codes, and schema validation), avoiding white-box dependencies on unexported internals.
