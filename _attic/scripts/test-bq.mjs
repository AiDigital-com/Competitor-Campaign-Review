import { BigQuery } from '@google-cloud/bigquery';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://njwzbptrhgznozpndcxf.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qd3picHRyaGd6bm96cG5kY3hmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzgzNzU0NywiZXhwIjoyMDg5NDEzNTQ3fQ.-H7y4lmDT5UAIbuCT8cSVUZ09OigwW204v1IH_xcxdI'
);

const { data } = await sb.from('ccr_secrets').select('value').eq('key', 'GCP_PRIVATE_KEY').single();
const pk = (data?.value || '').replace(/\\n/g, '\n');

const bq = new BigQuery({
  projectId: 'silken-quasar-376417',
  credentials: {
    client_email: 'aidigitallabs-bq-adclarity@silken-quasar-376417.iam.gserviceaccount.com',
    private_key: pk,
  },
});

const T = '`silken-quasar-376417.adclarity_competitor_analysis.adclarity_aws_monthly_test_2026`';
const DF = "month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH) AND country = 'United States'";

console.log('Query: campaigns LIMIT 1...');
const start = Date.now();
const [rows] = await bq.query({
  query: `SELECT LOWER(advertiser_domain) as advertiser_domain, 'United States' as country, creative_campaign_name, channel_name, advertiser_master_category, advertiser_second_category, transaction_method, ANY_VALUE(creative_landingpage_url) as landing_page_url, SUM(impressions) as impressions, SUM(spend) as spend, AVG(ctr) as ctr, COUNT(DISTINCT creative_id) as creative_count, COUNT(DISTINCT publisher_domain) as publisher_count, MIN(creative_first_seen_date) as first_seen, MAX(creative_last_seen_date) as last_seen FROM ${T} WHERE ${DF} AND LOWER(SUBSTR(advertiser_domain, 1, 1)) = 'a' GROUP BY 1,3,4,5,6,7 ORDER BY impressions DESC LIMIT 1`,
});
console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s — ${rows.length} rows`);
console.log(JSON.stringify(rows[0], (k, v) => v?.value !== undefined ? v.value : v, 2));
