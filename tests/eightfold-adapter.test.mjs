import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveEightfoldJobApiUrl,
  eightfoldJobFromPayload,
  extractEightfoldPostings,
  fetchEightfoldJobPayload,
} from '../lib/adapters/eightfold.mjs';
import {
  adapterKnownByScanner,
  classifySourceHealth,
  detectSourceAdapter,
} from '../lib/source-adapters.mjs';

const SOURCE_URL = 'https://careers.example.test/careers';

test('detects Eightfold before an embedded SuccessFactors system id', () => {
  const detection = detectSourceAdapter({
    url: SOURCE_URL,
    html: `
      <a href="https://eightfold.ai">Powered by Eightfold AI</a>
      <script>position.system_id = "successfactors"</script>
    `,
  });

  assert.deepEqual(detection, {
    adapter: 'eightfold',
    scanner: 'existing',
    reason: 'html pattern',
  });
  assert.equal(adapterKnownByScanner('eightfold'), true);
  assert.equal(classifySourceHealth({
    httpCode: 200,
    adapter: detection.adapter,
    scanner: detection.scanner,
  }).status, 'healthy');
});

test('extracts only same-origin Eightfold listing cards and deduplicates them', () => {
  const html = `
    <main>
      <a
        id="job-card-1001-job-list"
        role="button"
        aria-label="View job: Junior Software Engineer"
        href="/careers/job/1001"
      >
        <div class="title-a1">Junior Software Engineer</div>
        <div class="fieldValue-b2">Portugal, Lisboa</div>
        <div class="subData-c3">Posted 2 days ago</div>
      </a>
      <a
        id="job-card-1001-job-list"
        aria-label="View job: Duplicate"
        href="/careers/job/1001"
      >Duplicate</a>
      <a
        id="job-card-2002-job-list"
        aria-label="View job: External trap"
        href="https://attacker.example/careers/job/2002"
      >External trap</a>
      <a href="/careers/settings">Settings</a>
    </main>
  `;

  assert.deepEqual(extractEightfoldPostings(html, SOURCE_URL), [{
    id: '1001',
    title: 'Junior Software Engineer',
    location: 'Portugal, Lisboa',
    posted_text: 'Posted 2 days ago',
    link: 'https://careers.example.test/careers/job/1001',
  }]);
});

test('falls back to aria-labelled job links when listing ids are absent', () => {
  const postings = extractEightfoldPostings(`
    <a aria-label="View job: Graduate QA Engineer" href="/careers/job/qa-22">
      <span>Graduate QA Engineer</span>
    </a>
  `, SOURCE_URL);

  assert.equal(postings.length, 1);
  assert.equal(postings[0].id, 'qa-22');
  assert.equal(postings[0].title, 'Graduate QA Engineer');
});

test('derives the detail API only on the configured HTTPS origin', () => {
  assert.equal(
    deriveEightfoldJobApiUrl('https://careers.example.test/careers/job/1001', SOURCE_URL),
    'https://careers.example.test/api/apply/v2/jobs/1001',
  );
  assert.throws(
    () => deriveEightfoldJobApiUrl('https://careers.example.test.attacker.test/careers/job/1001', SOURCE_URL),
    /configured source origin/,
  );
  assert.throws(
    () => deriveEightfoldJobApiUrl('http://careers.example.test/careers/job/1001', SOURCE_URL),
    /credential-free HTTPS/,
  );
  assert.throws(
    () => deriveEightfoldJobApiUrl('https://careers.example.test/careers/job/../admin', SOURCE_URL),
    /valid job identifier/,
  );
});

test('fetches JSON with an HTTPS same-host allowlist and bounded response policy', async () => {
  let captured;
  const payload = { posting_name: 'Junior Developer', job_description: '<p>Build safe tools.</p>' };
  const fetcher = async (url, options) => {
    captured = { url, options };
    return {
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      json: async () => payload,
    };
  };

  const result = await fetchEightfoldJobPayload(
    'https://careers.example.test/careers/job/1001',
    SOURCE_URL,
    { fetcher },
  );

  assert.deepEqual(result, payload);
  assert.equal(captured.url, 'https://careers.example.test/api/apply/v2/jobs/1001');
  assert.deepEqual(captured.options.allowedHosts, ['careers.example.test']);
  assert.equal(captured.options.requireHttps, true);
  assert.equal(captured.options.maxResponseBytes, 2 * 1024 * 1024);
  assert.equal(captured.options.maxRedirects, 2);
});

test('rejects non-JSON detail responses', async () => {
  const fetcher = async () => ({
    status: 200,
    ok: true,
    headers: new Headers({ 'content-type': 'text/html' }),
    json: async () => ({}),
  });

  await assert.rejects(
    fetchEightfoldJobPayload(
      'https://careers.example.test/careers/job/1001',
      SOURCE_URL,
      { fetcher },
    ),
    /did not return JSON/,
  );
});

test('normalizes a synthetic Eightfold payload without candidate data', () => {
  const job = eightfoldJobFromPayload({
    posting_name: 'Junior Platform Engineer',
    job_description: '<h2>Overview</h2><p>Learn with a mentor and build Node.js services.</p>',
    locations: [{ city: 'Lisboa', country: 'Portugal' }],
    employment_type: 'Full-Time',
  }, {
    title: 'Fallback title',
    location: 'a confirmar',
    link: 'https://careers.example.test/careers/job/1001',
  }, 'Example Company');

  assert.equal(job.title, 'Junior Platform Engineer');
  assert.equal(job.company, 'Example Company');
  assert.equal(job.location, 'Lisboa, Portugal');
  assert.equal(job.description, 'Overview Learn with a mentor and build Node.js services.');
  assert.equal(job.employment_type, 'Full-Time');
  assert.equal(job.source, 'Example Company eightfold');
});
