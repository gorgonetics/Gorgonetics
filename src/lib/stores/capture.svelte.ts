/**
 * Capture tab state. Module-scoped so a sex set for a wild animal survives a
 * tab switch while the player is still deciding.
 */

import type { Gender } from '#lib/types/index.js';

export const captureView = $state({
  /**
   * The sex the player read in the game, by wild pet id. Kept apart from the
   * pet's stored gender, which a wild import fills with a default: only a sex
   * set here is known.
   */
  sexOf: {} as Record<number, Gender>,
});
