#!/usr/bin/env node
/* ============================================================================
   Casa García — récupération automatique des photos depuis Pexels
   ----------------------------------------------------------------------------
   PRÉREQUIS
     Node 18 ou plus récent (pour fetch natif). Vérifier : node --version
     Une clé API Pexels, gratuite : https://www.pexels.com/api/

   UTILISATION
     export PEXELS_KEY="ta_cle_ici"        # Windows : set PEXELS_KEY=ta_cle
     node fetch-photos.mjs

   OPTIONS
     node fetch-photos.mjs --force        redescend tout, écrase l'existant
     node fetch-photos.mjs --only e1,p9   ne traite que ces plats
     node fetch-photos.mjs --pick 3       descend 3 candidats par plat
                                          (nommés e1.jpg, e1_b.jpg, e1_c.jpg)

   COMPORTEMENT
     - Les fichiers déjà présents dans photos/ ne sont jamais écrasés sans
       --force. Tu peux donc déposer les vraies photos du restaurant et
       relancer le script : il ne remplira que les trous.
     - Génère photos/review.html : toutes les vignettes avec le nom du plat,
       à ouvrir dans le navigateur pour repérer les mauvaises correspondances
       en trente secondes.

   LICENCE
     Les photos Pexels sont libres d'usage commercial, sans attribution
     obligatoire. Elles restent un pis-aller : les vraies assiettes de
     Casa García vendront mieux l'application.
   ========================================================================= */

import { writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const KEY = process.env.PEXELS_KEY;
if (!KEY) {
  console.error('\n  Clé manquante. Fais : export PEXELS_KEY="ta_cle"\n' +
                '  Récupère-la sur https://www.pexels.com/api/\n');
  process.exit(1);
}

const args   = process.argv.slice(2);
const FORCE  = args.includes('--force');
const PICK   = Number((args.find(a => a.startsWith('--pick')) || '').split(/[= ]/)[1]
               || args[args.indexOf('--pick') + 1] || 1) || 1;
const ONLY   = (() => {
  const i = args.indexOf('--only');
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',')) : null;
})();

const OUT = 'photos';

/* ----------------------------------------------------------------------------
   Les requêtes sont volontairement en anglais ou en espagnol : Pexels est
   indexé dans ces langues, le français ne renvoie presque rien.
   Si un résultat ne convient pas, change la requête ici et relance avec
   --only suivi de l'identifiant.
---------------------------------------------------------------------------- */
const DISHES = [
  ['e1',  'Salade de poivrons',          'roasted red pepper salad'],
  ['e2',  'Salade mixte',                'mixed green salad plate'],
  ['e3',  'Salade russe',                'potato salad mayonnaise bowl'],
  ['e4',  'Anchois au vinaigre',         'boquerones anchovies vinegar'],
  ['e5',  'Jambon serrano',              'jamon serrano plate'],
  ['e6',  'Fromage manchego',            'manchego cheese wedges'],
  ['e7',  'Palourdes',                   'clams white wine garlic'],
  ['e8',  'Salade de fruits de mer',     'seafood salad plate'],
  ['e9',  'Croquettes',                  'croquetas spanish tapas'],
  ['e10', 'Civelles',                    'baby eels dish'],
  ['e11', 'Gambas',                      'king prawns plate'],
  ['e12', 'Homard',                      'cooked lobster plate'],
  ['e13', 'Langouste',                   'spiny lobster seafood'],
  ['e14', 'Araignée de mer',             'crab seafood platter'],
  ['e15', 'Crevettes royales',           'red prawns carabineros'],
  ['e16', 'Langoustines',                'langoustine seafood'],

  ['p1',  'Soupe de poisson',            'fish soup bowl'],
  ['p2',  'Spaghetti aux fruits de mer', 'seafood spaghetti pasta'],
  ['p3',  'Paella',                      'seafood paella pan'],
  ['p4',  'Omelette espagnole',          'tortilla espanola potato omelette'],
  ['p5',  'Omelette au thon',            'tuna omelette'],
  ['p6',  'Omelette au jambon',          'ham omelette'],
  ['p7',  'Omelette au fromage',         'cheese omelette'],
  ['p8',  'Gambas à la plancha',         'grilled prawns plancha'],
  ['p9',  "Gambas à l'ail",              'gambas al ajillo garlic prawns'],
  ['p10', 'Omelette aux crevettes',      'prawn omelette'],
  ['p11', 'Calamars à la romaine',       'calamares fritos squid rings'],
  ['p12', 'Merlan',                      'fried white fish plate'],
  ['p13', 'Sole',                        'grilled sole fish'],
  ['p14', 'Rougets',                     'red mullet fish grilled'],
  ['p15', 'Anchois frais',               'fried fresh anchovies'],
  ['p16', 'Espadon',                     'grilled swordfish steak'],
  ['p17', 'Petits calamars',             'baby squid chipirones'],
  ['p18', 'Sardines',                    'grilled sardines'],
  ['p19', 'Bifteck de bœuf',             'beef steak plate'],
  ['p20', 'Bifteck à la tomate',         'beef tomato sauce dish'],
  ['p21', 'Kefta',                       'kefta tagine meatballs'],

  ['s1',  'Chaudron de poissons',        'fish stew pot'],
  ['s2',  'Fideuà',                      'fideua noodle paella'],
  ['s3',  'Riz noir',                    'arroz negro squid ink rice'],
  ['s4',  'Riz crémeux au homard',       'lobster rice dish'],
  ['s5',  'Rigamonte',                   'seafood platter sharing'],

  ['ds1', 'Flan caramel',                'creme caramel flan dessert'],
  ['ds2', 'Crème vanille',               'vanilla custard dessert'],
  ['ds3', 'Tarte au citron',             'lemon tart slice'],
  ['ds4', 'Mousse au chocolat',          'chocolate mousse dessert'],
  ['ds5', 'Fruits de saison',            'fresh fruit plate dessert'],
  ['ds6', 'Glace',                       'ice cream scoops bowl'],
  ['ds7', 'Flan au biscuit',             'biscuit pudding dessert']
];

const exists = async f => { try { await access(f, constants.F_OK); return true; }
                            catch { return false; } };
const wait   = ms => new Promise(r => setTimeout(r, ms));
const suffix = i => ['', '_b', '_c', '_d', '_e'][i] ?? `_${i}`;

/* Pexels sert des versions redimensionnées via l'URL : on demande
   directement un carré de 800 px, pas besoin de retoucher ensuite. */
const square = src => `${src.split('?')[0]}?auto=compress&cs=tinysrgb&fit=crop&w=800&h=800`;

async function search(query) {
  const url = 'https://api.pexels.com/v1/search'
            + `?query=${encodeURIComponent(query)}`
            + `&per_page=${Math.max(PICK, 1)}&orientation=square`;
  const res = await fetch(url, { headers: { Authorization: KEY } });
  if (res.status === 429) throw new Error('quota horaire Pexels atteint — réessaie dans une heure');
  if (!res.ok) throw new Error(`Pexels a répondu ${res.status}`);
  const data = await res.json();
  return data.photos || [];
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const report = [];
  let saved = 0, skipped = 0, missing = 0;

  for (const [id, label, query] of DISHES) {
    if (ONLY && !ONLY.has(id)) continue;

    const first = path.join(OUT, `${id}.jpg`);
    if (!FORCE && await exists(first)) {
      console.log(`  ·  ${id.padEnd(4)} déjà présent, ignoré`);
      report.push({ id, label, file: `${id}.jpg`, note: 'déjà présent' });
      skipped++;
      continue;
    }

    try {
      const photos = await search(query);
      if (!photos.length) {
        console.log(`  ✗  ${id.padEnd(4)} aucun résultat pour « ${query} »`);
        report.push({ id, label, file: null, note: `rien trouvé : ${query}` });
        missing++;
        await wait(300);
        continue;
      }

      for (let i = 0; i < Math.min(PICK, photos.length); i++) {
        const p    = photos[i];
        const file = path.join(OUT, `${id}${suffix(i)}.jpg`);
        const img  = await fetch(square(p.src.large2x || p.src.large || p.src.original));
        if (!img.ok) throw new Error(`téléchargement ${img.status}`);
        await writeFile(file, Buffer.from(await img.arrayBuffer()));
        report.push({ id, label, file: path.basename(file), credit: p.photographer });
        saved++;
      }
      console.log(`  ✓  ${id.padEnd(4)} ${label}`);
      await wait(300);                       // on reste poli avec l'API
    } catch (e) {
      console.log(`  ✗  ${id.padEnd(4)} ${e.message}`);
      report.push({ id, label, file: null, note: e.message });
      missing++;
      if (/quota/.test(e.message)) break;
    }
  }

  await writeReview(report);
  console.log(`\n  ${saved} téléchargées · ${skipped} conservées · ${missing} en échec`);
  console.log(`  Ouvre ${OUT}/review.html pour vérifier les correspondances.\n`);
}

async function writeReview(rows) {
  const cards = rows.map(r => `
    <figure>
      ${r.file ? `<img src="${r.file}" alt="">`
               : `<div class="none">${r.note || 'manquant'}</div>`}
      <figcaption><b>${r.label}</b><span>${r.file || r.id}</span></figcaption>
    </figure>`).join('');

  await writeFile(path.join(OUT, 'review.html'), `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Casa García — vérification des photos</title>
<style>
 body{font-family:system-ui,sans-serif;background:#F2F0EB;color:#16202E;margin:0;padding:24px}
 h1{font-size:22px;margin:0 0 6px}
 p.lead{color:#5C6675;margin:0 0 22px;font-size:14px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}
 figure{margin:0}
 img,.none{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;border:1px solid #D6D0C4;display:block}
 .none{background:#E7E4DC;color:#8A8378;font-size:12px;display:flex;align-items:center;
       justify-content:center;text-align:center;padding:10px}
 figcaption{margin-top:7px;font-size:13px;line-height:1.35}
 figcaption b{display:block}
 figcaption span{color:#8A8378;font-size:11px;font-family:ui-monospace,monospace}
</style></head><body>
<h1>Vérification des photos</h1>
<p class="lead">Repère les correspondances douteuses, note l'identifiant, corrige la requête
dans fetch-photos.mjs puis relance : <code>node fetch-photos.mjs --only e3,p12 --force</code></p>
<div class="grid">${cards}</div>
</body></html>`);
}

run().catch(e => { console.error('\n  ' + e.message + '\n'); process.exit(1); });
