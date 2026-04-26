import { beforeEach, describe, expect, it, vi } from 'vitest';

// isTauri is read by both database init (we want false there, so it picks
// the in-memory adapter) and imageService.getImageUrl (we want true so the
// asset-protocol path runs and populates the cache). Make it stateful so
// each test can flip it after DB init.
let mockIsTauriValue = false;
vi.mock('$lib/utils/environment.js', () => ({
  isTauri: () => mockIsTauriValue,
}));

// Stub the fs plugin so deleteImage / deleteAllImagesForPet don't try to
// touch the real filesystem when invalidating the cache.
vi.mock('@tauri-apps/plugin-fs', () => ({
  remove: vi.fn(async () => {}),
  BaseDirectory: { AppData: 0 },
}));

const { closeDatabase, getDb, initDatabase } = await import('$lib/services/database.js');
const { runMigrations } = await import('$lib/services/migrationService.js');
const imageService = await import('$lib/services/imageService.js');
const { _imageUrlInternals } = imageService;

// Replace the real Tauri-backed resolver with a deterministic spy. The cache
// only calls the resolver on a miss, so the spy's call count tells us
// directly whether a (petId, filename) pair was cached.
const resolverSpy = vi.fn(async (petId, filename) => `asset://${petId}/${filename}`);
const originalResolver = _imageUrlInternals.resolver;

async function seedPet() {
  const db = getDb();
  const result = await db.execute(
    `INSERT INTO pets (name, species, gender, breed, breeder, content_hash, genome_data, notes, created_at, updated_at,
      intelligence, toughness, friendliness, ruggedness, enthusiasm, virility, ferocity, temperament, sort_order,
      starred, stabled, is_pet_quality)
     VALUES ($name, $species, $gender, '', '', $content_hash, '{}', '', '2026-01-01', '2026-01-01',
      50, 50, 50, 50, 50, 50, 50, 50, 0,
      0, 1, 0)`,
    { name: 'Test', species: 'BeeWasp', gender: 'Female', content_hash: `hash_${Math.random()}` },
  );
  return result.lastInsertId;
}

async function seedImage(petId, filename) {
  const db = getDb();
  const result = await db.execute(
    `INSERT INTO pet_images (pet_id, filename, original_name, caption, tags, created_at, sort_order)
     VALUES ($pet_id, $filename, $filename, '', '[]', '2026-01-01', 0)`,
    { pet_id: petId, filename },
  );
  return result.lastInsertId;
}

describe('imageService — getImageUrl cache', () => {
  beforeEach(async () => {
    resolverSpy.mockClear();
    _imageUrlInternals.resolver = resolverSpy;
    _imageUrlInternals.cache.clear();
    mockIsTauriValue = false; // initDatabase needs this so it picks the in-memory adapter
    await closeDatabase();
    await initDatabase();
    await runMigrations();
    mockIsTauriValue = true; // now flip so getImageUrl exercises the asset-protocol path
  });

  it('reuses the cached URL on repeat calls for the same image', async () => {
    const petId = await seedPet();
    await seedImage(petId, 'a.png');

    const first = await imageService.getImagesForPet(petId);
    const second = await imageService.getImagesForPet(petId);

    expect(first[0].url).toBe(second[0].url);
    expect(resolverSpy).toHaveBeenCalledTimes(1);
  });

  it("deleteImage invalidates that image's cached URL", async () => {
    const petId = await seedPet();
    const imageId = await seedImage(petId, 'b.png');

    await imageService.getImagesForPet(petId);
    expect(resolverSpy).toHaveBeenCalledTimes(1);

    await imageService.deleteImage(imageId, petId, 'b.png');
    // Re-seed the same filename and confirm the URL is recomputed.
    await seedImage(petId, 'b.png');
    await imageService.getImagesForPet(petId);

    expect(resolverSpy).toHaveBeenCalledTimes(2);
  });

  it('deleteAllImagesForPet drops every cache entry for that pet', async () => {
    const petId = await seedPet();
    await seedImage(petId, 'c.png');
    await seedImage(petId, 'd.png');

    await imageService.getImagesForPet(petId);
    expect(resolverSpy).toHaveBeenCalledTimes(2);

    await imageService.deleteAllImagesForPet(petId);
    await seedImage(petId, 'c.png');
    await seedImage(petId, 'd.png');
    await imageService.getImagesForPet(petId);

    expect(resolverSpy).toHaveBeenCalledTimes(4);
  });

  it('keeps separate cache entries per pet', async () => {
    const petA = await seedPet();
    const petB = await seedPet();
    await seedImage(petA, 'shared.png');
    await seedImage(petB, 'shared.png');

    await imageService.getImagesForPet(petA);
    await imageService.getImagesForPet(petB);

    // Same filename, different petIds — two distinct cache entries.
    expect(resolverSpy).toHaveBeenCalledTimes(2);
  });
});

// Make sure other test files that import imageService get the real resolver back.
_imageUrlInternals.resolver = originalResolver;
