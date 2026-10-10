// Lecteur de fichiers d'import (public/app/import.js, exécuté dans le navigateur) : testé ici dans Node
// avec de vrais fichiers d'exemple (tests/fixtures). Les bases SQLite et Access demandent les lecteurs
// chargés par le navigateur : elles sont vérifiées à la main (voir docs/CONTRIBUTING.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/adapters/node/env.js';

const win = {};
new Function('window', readFileSync(join(ROOT, 'public/app/import.js'), 'utf8'))(win);
const CI = win.ComptoirImport;
const fixture = (name) => new File([readFileSync(join(ROOT, 'tests/fixtures', name))], name);
async function load(name, opts) {
  const sheet = await CI.readFile(fixture(name), opts);
  const source = CI.detect(sheet.headers);
  const map = CI.autoMap(sheet.headers, source);
  const stockMap = map.stocks.length ? { 1: map.stocks[0] } : {};
  return { sheet, source, map, items: CI.toProducts(sheet, map, { stockMap, tvaDefault: 20 }) };
}

test('nombres écrits de toutes les façons', () => {
  for (const [v, n] of [['1 234,50 €', 1234.5], ['1.234,50', 1234.5], ['1,234.50', 1234.5], ['12,5', 12.5], ['12 500', 12500], ['abc', null], ['', null], ['-', null], ['3.01762E+12', 3017620000000]]) assert.equal(CI.number(v), n, v);
});

test('Loyverse : variantes sur plusieurs lignes, catégorie héritée, vente au poids', async () => {
  const { source, items } = await load('loyverse.csv');
  assert.equal(source.key, 'loyverse');
  assert.deepEqual(items.map((i) => i.name), ['Marteau 500 g', 'Gants de travail M', 'Gants de travail L', 'Clous vrac']);
  assert.equal(items[2].category, 'Protection'); assert.equal(items[3].unit, 'kg');
});

test('Shopify, Square, WooCommerce : lignes inutiles ignorées', async () => {
  const shopify = await load('shopify.csv');
  assert.deepEqual(shopify.items.map((i) => i.name), ['T-shirt coton Blanc', 'T-shirt coton Noir', 'Sac en cuir']);
  assert.equal(shopify.items[0].description, '100 % coton');
  assert.equal((await load('square.csv')).items.length, 3, 'article archivé ignoré');
  const woo = await load('woocommerce.csv');
  assert.deepEqual(woo.items.map((i) => i.category), ['Fruits secs', 'Miel', 'Miel'], 'produit parent ignoré, dernier niveau de catégorie');
});

test('EBP (Windows, point-virgule) : prix HT convertis, code-barres abîmé signalé', async () => {
  const { sheet, source, items } = await load('ebp.csv');
  assert.equal(sheet.encoding, 'windows-1252'); assert.equal(source.key, 'ebp');
  assert.equal(items[0].name, 'Perceuse sans fil 18 V'); assert.equal(Math.round(items[0].price_ttc * 100) / 100, 1481.4);
  assert.equal(items[0].barcode, ''); assert.match(items[0].warn.join(), /Excel/);
  assert.match(items[2].warn.join(), /illisible/);
});

test('Stock Express : plusieurs codes-barres dans une cellule', async () => {
  const { source, items } = await load('stockexpress.csv');
  assert.equal(source.key, 'stockexpress');
  assert.equal(items[0].barcode, '6111111111111'); assert.match(items[0].warn.join(), /2 codes-barres/);
});

test('encodages : UTF-16 (« Unicode ») et Windows arabe', async () => {
  const u = await load('export-unicode.csv');
  assert.equal(u.sheet.encoding, 'utf-16le');
  assert.deepEqual(u.items.map((i) => i.name), ['Riz parfumé 25 kg', 'زيت نباتي 5 لتر', 'Savon de Marseille']);
  const a = await load('export-arabe.csv');
  assert.equal(a.sheet.encoding, 'windows-1256'); assert.equal(a.items[0].name, 'زيت نباتي 5 لتر');
  const forced = await load('export-arabe.csv', { encoding: 'windows-1252' });
  assert.notEqual(forced.items[0].name, 'زيت نباتي 5 لتر', 'l’encodage imposé est bien appliqué');
});

test('dBase : noms tronqués, ligne supprimée, page de code arabe', async () => {
  const d = await load('ARTICLES.DBF');
  assert.deepEqual(d.items.map((i) => i.name), ['Ciment 50 kg', 'Fer à béton 10 mm']);
  assert.equal(d.items[0].barcode, '6115555555557');
  const ar = await load('ARABE.DBF');
  assert.equal(ar.sheet.encoding, 'windows-1256'); assert.equal(ar.items[0].name, 'زيت زيتون 1 لتر');
});

test('pages de code DOS (437 et 850) décodées sans le navigateur', async () => {
  assert.equal(CI.DOS.ibm850.length, 128); assert.equal(CI.DOS.ibm437.length, 128);
  const bytes = new Uint8Array([0x43, 0x61, 0x66, 0x82, 0x3b, 0x50, 0x72, 0x69, 0x78, 0x0d, 0x0a, 0x50, 0x8a, 0x63, 0x68, 0x65, 0x3b, 0x31, 0x32]); // « Café;Prix / Pèche;12 »
  const sheet = await CI.readFile(new File([bytes], 'dos.csv'), { encoding: 'ibm850' });
  assert.deepEqual(sheet.headers, ['Café', 'Prix']); assert.equal(sheet.rows[0][0], 'Pèche');
});

test('fichier binaire inconnu : message clair et signature, jamais de caractères au hasard', async () => {
  const bytes = new Uint8Array(4096); bytes.set([0x4b, 0x4c, 0x49, 0x43, 0x4b]); for (let i = 5; i < 4096; i++) bytes[i] = i % 7;
  await assert.rejects(CI.readFile(new File([bytes], 'base.stockdb')), (e) => /Stock Express/.test(e.message) && /4b 4c 49 43 4b/.test(e.detail));
});
