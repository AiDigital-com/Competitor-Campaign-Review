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

console.log(`[${letter}] BQ query starting...`);
const t0 = Date.now();
const [rows] = await bq.query({
  query: `SELECT LOWER(advertiser_domain) as advertiser_domain, 'United States' as country, publisher_domain as publisher_group, transaction_method, SUM(impressions) as impressions, SUM(spend) as spend, SUM(CASE WHEN channel_name LIKE '%Display%' THEN impressions ELSE 0 END) as display_impressions, SUM(CASE WHEN channel_name LIKE '%Video%' THEN impressions ELSE 0 END) as video_impressions, SUM(CASE WHEN channel_name LIKE '%Social%' THEN impressions ELSE 0 END) as social_impressions, SUM(CASE WHEN channel_name LIKE '%CTV%' THEN impressions ELSE 0 END) as ctv_impressions FROM ${T} WHERE ${DF} AND LOWER(SUBSTR(advertiser_domain, 1, 1)) = @letter GROUP BY 1,3,4 ORDER BY impressions DESC`,
  params: { letter },
});
console.log(`[${letter}] BQ returned ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const next = String.fromCharCode(letter.charCodeAt(0) + 1);
await sb.from('ccr_publisher_channel_method').delete().gte('advertiser_domain', letter).lt('advertiser_domain', next);

let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const { error } = await sb.from('ccr_publisher_channel_method').insert(batch);
  if (error) { console.error(`[${letter}] Insert error at ${i}:`, error.message); break; }
  inserted += batch.length;
  if (i % 5000 === 0) process.stdout.write(`\r[${letter}] Inserted ${inserted}/${rows.length}`);
}
console.log(`\n[${letter}] Done: ${inserted}/${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
