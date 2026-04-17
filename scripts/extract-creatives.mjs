import { BigQuery } from '@google-cloud/bigquery';
import { createClient } from '@supabase/supabase-js';

const letter = process.argv[2] || 'a';
const BATCH = 500;

const sb = createClient(
  'https://njwzbptrhgznozpndcxf.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qd3picHRyaGd6bm96cG5kY3hmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzgzNzU0NywiZXhwIjoyMDg5NDEzNTQ3fQ.-H7y4lmDT5UAIbuCT8cSVUZ09OigwW204v1IH_xcxdI'
);

const { data } = await sb.from('ccr_secrets').select('value').eq('key', 'GCP_PRIVATE_KEY').single();
const pk = (data?.value || '').replace(/\\n/g, '\n');
const bq = new BigQuery({
  projectId: 'silken-quasar-376417',
  credentials: { client_email: 'aidigitallabs-bq-adclarity@silken-quasar-376417.iam.gserviceaccount.com', private_key: pk },
});

const T = '`silken-quasar-376417.adclarity_competitor_analysis.adclarity_aws_monthly_test_2026`';
const DF = "month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH) AND country = 'United States'";

function ser(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v && typeof v === 'object' && v.value !== undefined ? v.value : v;
  }
  return out;
}

console.log(`[${letter}] BQ query starting...`);
const t0 = Date.now();
const [rows] = await bq.query({
  query: `SELECT LOWER(advertiser_domain) as advertiser_domain, 'United States' as country, CAST(creative_id AS STRING) as creative_id, creative_campaign_name, channel_name, creative_url_supplier, creative_landingpage_url, creative_mime_type, creative_size, creative_video_duration, MIN(creative_first_seen_date) as first_seen, MAX(creative_last_seen_date) as last_seen, SUM(impressions) as impressions, SUM(spend) as spend, AVG(ctr) as ctr FROM ${T} WHERE ${DF} AND LOWER(SUBSTR(advertiser_domain, 1, 1)) = @letter GROUP BY 1,3,4,5,6,7,8,9,10 ORDER BY impressions DESC`,
  params: { letter },
});
console.log(`[${letter}] BQ returned ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const next = String.fromCharCode(letter.charCodeAt(0) + 1);
await sb.from('ccr_creative_detail').delete().gte('advertiser_domain', letter).lt('advertiser_domain', next);

let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH).map(ser);
  const { error } = await sb.from('ccr_creative_detail').insert(batch);
  if (error) { console.error(`[${letter}] Insert error at ${i}:`, error.message); break; }
  inserted += batch.length;
  if (i % 5000 === 0) process.stdout.write(`\r[${letter}] Inserted ${inserted}/${rows.length}`);
}
console.log(`\n[${letter}] Done: ${inserted}/${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
