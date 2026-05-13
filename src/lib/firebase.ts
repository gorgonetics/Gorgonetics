/**
 * Firebase SDK initialisation for the public pet sharing catalogue.
 *
 * The config object below is public — it identifies the Firebase project but
 * is not a secret. Security comes from `firestore.rules`, not from hiding
 * these values.
 *
 * Before this module can talk to a real project, replace the placeholder
 * values with the config printed by `firebase apps:sdkconfig web` after
 * creating the `gorgonetics-share` Firebase project on the Spark plan.
 * See docs/firebase-setup.md for the full procedure.
 */

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'PLACEHOLDER_REPLACE_AFTER_PROJECT_CREATION',
  authDomain: 'gorgonetics-share.firebaseapp.com',
  projectId: 'gorgonetics-share',
};

// Guard against Vite HMR / test re-imports double-initialising the default app
// (which would throw `FirebaseError: Firebase: Firebase App named '[DEFAULT]'
// already exists`). Reusing the existing instance is the documented pattern.
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firestore = getFirestore(app);
