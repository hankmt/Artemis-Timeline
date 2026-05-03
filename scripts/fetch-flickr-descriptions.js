#!/usr/bin/env node
/**
 * Fetch missing photo descriptions from Flickr API
 *
 * Usage:
 *   node fetch-flickr-descriptions.js
 *
 * This will output a JSON object mapping Flickr photo IDs to their
 * titles and descriptions, ready to paste into photos.js.
 *
 * No API key needed — uses the public endpoint.
 */

const https = require('https');

const FLICKR_IDS = [
  '55186319833',
  '55224434205',
  '55223125677',
  '55224434210',
  '55224434240',
  '55224193193',
  '55206257809',
  '55209951780',
  '55207655441',
  '55207935871',
  '55206722770',
  '55206394005',
  '55208655682',
  '55208327975',
  '55204753657',
  '55207839868',
  '55207787628',
  '55208682757',
  '55208397810',
  '55207851286',
  '55203738393',
  '55203592291',
  '55203585621',
  '55203833379',
  '55203586701',
  '55203981890',
  '55203734853',
  '55201423841',
];

// Flickr public API key (non-commercial, rate-limited)
const API_KEY = '0407a2e71f8e025e73a050e6c7a1edf6';

function fetchPhotoInfo(photoId) {
  return new Promise((resolve, reject) => {
    const url = `https://api.flickr.com/services/rest/?method=flickr.photos.getInfo&api_key=${API_KEY}&photo_id=${photoId}&format=json&nojsoncallback=1`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.stat === 'ok') {
            resolve({
              id: photoId,
              title: json.photo.title._content || '',
              description: json.photo.description._content || '',
            });
          } else {
            resolve({ id: photoId, title: '', description: '', error: json.message });
          }
        } catch (e) {
          resolve({ id: photoId, title: '', description: '', error: e.message });
        }
      });
    }).on('error', (e) => {
      resolve({ id: photoId, title: '', description: '', error: e.message });
    });
  });
}

// Simple HTML tag stripper
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

async function main() {
  console.log(`Fetching descriptions for ${FLICKR_IDS.length} photos...\n`);

  const results = {};

  for (const id of FLICKR_IDS) {
    const info = await fetchPhotoInfo(id);
    if (info.error) {
      console.error(`  ✗ ${id}: ${info.error}`);
    } else {
      const desc = stripHtml(info.description);
      console.error(`  ✓ ${id}: "${info.title}"`);
      results[id] = {
        title: info.title,
        flickr_desc: desc || info.title,
      };
    }
    // Small delay to be nice to the API
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n=== RESULTS (paste-ready JSON) ===\n');
  console.log(JSON.stringify(results, null, 2));

  // Also output as a quick reference for manual editing
  console.log('\n=== QUICK REFERENCE ===\n');
  for (const [id, data] of Object.entries(results)) {
    console.log(`${id}:`);
    console.log(`  title: "${data.title}"`);
    console.log(`  flickr_desc: "${data.flickr_desc}"`);
    console.log('');
  }
}

main();
