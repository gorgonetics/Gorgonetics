/**
 * Firebase SDK initialisation for the public pet sharing catalogue.
 *
 * The config object below is public — it identifies the Firebase project but
 * is not a secret. Security comes from `firestore.rules`, not from hiding
 * these values.
 *
 * The config below is the real public config for the `gorgonetics` Firebase
 * project (Spark plan), printed by `firebase apps:sdkconfig web`. See
 * docs/firebase-setup.md for the full procedure.
 */

import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const PLACEHOLDER_API_KEY = 'PLACEHOLDER_REPLACE_AFTER_PROJECT_CREATION';

const firebaseConfig = {
  apiKey: 'AIzaSyC4dMgz9Ocu1-KOp-DGxZOOwdm4zS1VRC0',
  authDomain: 'gorgonetics.firebaseapp.com',
  projectId: 'gorgonetics',
  storageBucket: 'gorgonetics.firebasestorage.app',
  messagingSenderId: '12621482059',
  appId: '1:12621482059:web:dd9960e2d6d1a7a592a5ce',
};

export const isPlaceholderConfig = firebaseConfig.apiKey === PLACEHOLDER_API_KEY;

if (isPlaceholderConfig) {
  console.warn(
    '[firebase] Using placeholder Firebase config. Public pet sharing is disabled until ' +
      'src/lib/firebase.ts is updated with the real apiKey — see docs/firebase-setup.md.',
  );
}

/**
 * Throws a clear, actionable error if the placeholder config is still in
 * place. Service-layer entry points (uploadPet, listPets, etc.) call this
 * before issuing any Firestore request so misconfigured builds fail loudly
 * instead of silently emitting 401/permission-denied responses.
 */
export function assertFirebaseConfigured(): void {
  if (isPlaceholderConfig) {
    throw new Error(
      'Firebase is not configured: src/lib/firebase.ts still uses the placeholder ' +
        'apiKey. Replace it with the real public config from the gorgonetics ' +
        'project (see docs/firebase-setup.md) before using the community catalogue.',
    );
  }
}

// Guard against Vite HMR / test re-imports double-initialising the default app
// (which would throw `FirebaseError: Firebase: Firebase App named '[DEFAULT]'
// already exists`). Reusing the existing instance is the documented pattern.
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firestore = getFirestore(app);

// Opt-in Firestore emulator for local dev (#281). Since #279 committed the
// real public config, every build — including `pnpm dev` — otherwise talks to
// the live production catalogue, burning read quota and writing real docs.
// Set VITE_USE_FIRESTORE_EMULATOR=true to route share/import at the local
// emulator (localhost:8080, per firebase.json) instead. Dev-only and opt-in:
// some workflows still want to hit production, so this stays off by default.
// See docs/firebase-setup.md.
if (import.meta.env.DEV && import.meta.env.VITE_USE_FIRESTORE_EMULATOR === 'true') {
  try {
    connectFirestoreEmulator(firestore, 'localhost', 8080);
    console.info('[firebase] Connected to Firestore emulator at localhost:8080 (VITE_USE_FIRESTORE_EMULATOR).');
  } catch (err) {
    // connectFirestoreEmulator throws if Firestore has already been used or
    // re-connected (e.g. Vite HMR re-running this module). Harmless — the
    // first connection stands.
    console.warn('[firebase] Firestore emulator connection skipped:', err);
  }
}
