/**
 * Firebase SDK initialisation for the public pet sharing catalogue.
 *
 * The config object below is public — it identifies the Firebase project but
 * is not a secret. Security comes from `firestore.rules`, not from hiding
 * these values.
 *
 * Before this module can talk to a real project, replace the placeholder
 * values with the config printed by `firebase apps:sdkconfig web` after
 * creating the `gorgonetics` Firebase project on the Spark plan.
 * See docs/firebase-setup.md for the full procedure.
 */

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const PLACEHOLDER_API_KEY = 'PLACEHOLDER_REPLACE_AFTER_PROJECT_CREATION';

const firebaseConfig = {
  apiKey: PLACEHOLDER_API_KEY,
  authDomain: 'gorgonetics.firebaseapp.com',
  projectId: 'gorgonetics',
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
