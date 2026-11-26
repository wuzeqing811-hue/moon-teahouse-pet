const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { parseLook, resolvedLook } = require('../dist/main/wardrobe');
const { Storage } = require('../dist/main/storage');
const catalog = require('../assets/wardrobe/catalog.json');

test('the custom catalogue contains 24 separate items with distinct cuts and six hairstyles', () => {
  assert.equal(catalog.tops.length, 12);
  assert.equal(catalog.bottoms.filter(item => item.kind === 'skirt').length, 6);
  assert.equal(catalog.bottoms.filter(item => item.kind === 'pants').length, 6);
  const items = [...catalog.tops, ...catalog.bottoms];
  assert.equal(new Set(items.map(item => item.id)).size, 24);
  assert.equal(new Set(catalog.tops.map(item => item.cut)).size, 12);
  assert.equal(new Set(catalog.bottoms.map(item => item.cut)).size, 12);
  assert.equal(catalog.hairs.length, 6);
});

test('every catalog item ships a unique 32-bit transparent illustration', () => {
  const hashes = [];
  for (const { id } of [...catalog.tops, ...catalog.bottoms]) {
    const png = fs.readFileSync(path.join(__dirname, '..', 'assets', 'wardrobe', 'illustrated', `${id}.png`));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', id);
    assert.equal(png.toString('ascii', 12, 16), 'IHDR', id);
    assert.equal(png[24], 8, id);
    assert.equal(png[25], 6, id);
    assert(png.readUInt32BE(16) >= 256 && png.readUInt32BE(20) >= 256, id);
    hashes.push(createHash('sha256').update(png).digest('hex'));
  }
  assert.equal(new Set(hashes).size, 24);
});

test('both built-in roles can mix every upper with every lower and select independent colors', () => {
  assert.deepEqual(Object.keys(catalog.defaults).sort(), ['fox', 'girl']);
  for (const role of Object.keys(catalog.defaults)) {
    for (const top of catalog.tops) for (const bottom of catalog.bottoms) {
      const values = { top: top.id, bottom: bottom.id, hair: 'braids', hairColor: '#FF7592', eyeColor: '#b198ff', active: true };
      const resolved = resolvedLook(catalog, role, values);
      assert.equal(resolved.top.id, top.id);
      assert.equal(resolved.bottom.id, bottom.id);
      assert.equal(resolved.hair, 'braids');
      assert.equal(resolved.hairColor, '#ff7592');
      assert.equal(resolved.eyeColor, '#b198ff');
    }
  }
  const values = { ...catalog.defaults.girl, hair: 'original', hairColor: 'url(https://example.test)', eyeColor: '', active: true };
  assert.equal(parseLook(catalog, 'girl', values).hairColor, '');
  assert.equal(parseLook(catalog, 'imported', values), undefined);
  assert.equal(parseLook(catalog, 'girl', { ...values, top: 'unknown' }), undefined);
  assert.equal(resolvedLook(catalog, 'girl', { ...values, active: false }), undefined);
});

test('saved looks remain independent of other roles and the selected stock outfit', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'teahouse-closet-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const storage = new Storage(folder);
  storage.save({ outfitId: 'character_08', size: 246, looks: {
    fox: { ...catalog.defaults.fox, hair: 'pony', hairColor: '#a54b68', eyeColor: '#568fd1', active: true },
    girl: { ...catalog.defaults.girl, hair: 'bob', hairColor: '', eyeColor: '', active: false },
  } });
  const restored = new Storage(folder).profile;
  assert.equal(restored.size, 246);
  assert.equal(restored.outfitId, 'character_08');
  assert.equal(resolvedLook(catalog, 'fox', restored.looks.fox).eyeColor, '#568fd1');
  assert.equal(resolvedLook(catalog, 'girl', restored.looks.girl), undefined);
  assert.equal(parseLook(catalog, 'girl', restored.looks.girl).hair, 'bob');
});
