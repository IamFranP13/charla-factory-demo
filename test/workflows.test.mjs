import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const raw = (name) => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')
const load = (name) => parse(raw(name))
const steps = (wf, job) => wf.jobs[job].steps

test('factory.yml: triggers on issues opened/labeled, only for the "entrada" label', () => {
  const wf = load('factory')
  assert.deepEqual(Object.keys(wf.on), ['issues'])
  assert.deepEqual(wf.on.issues.types, ['opened', 'labeled'])
  assert.match(wf.jobs.factory.if, /contains\(github\.event\.issue\.labels\.\*\.name, 'entrada'\)/)
})

test('factory.yml: one run per issue and minimal permissions', () => {
  const wf = load('factory')
  assert.match(wf.concurrency.group, /github\.event\.issue\.number/)
  assert.deepEqual(wf.permissions, { contents: 'read', issues: 'write' })
})

test('factory.yml: pushes and opens the PR with a GitHub App token', () => {
  const wf = load('factory')
  const app = steps(wf, 'factory').find((s) => s.uses?.startsWith('actions/create-github-app-token@'))
  assert.ok(app, 'create-github-app-token step')
  assert.equal(app.with['app-id'], '${{ secrets.FACTORY_APP_ID }}')
  assert.equal(app.with['private-key'], '${{ secrets.FACTORY_APP_PRIVATE_KEY }}')
  const pr = steps(wf, 'factory').find((s) => s.id === 'pr')
  assert.match(pr.env.GH_TOKEN, /steps\.app\.outputs\.token/)
  assert.match(pr.run, /gh pr create/)
  assert.match(pr.run, /Closes #\$ISSUE/)
  assert.match(pr.run, /perfil:\$PROFILE/)
  assert.match(pr.run, /tarea\/\$ISSUE/)
})

test('factory.yml: runs the factory with provider vars and the API key secret', () => {
  const step = steps(load('factory'), 'factory').find((s) => s.id === 'factory')
  assert.match(step.run, /node scripts\/factory\.mjs --issue "\$ISSUE"/)
  assert.equal(step.env.FACTORY_PROVIDER, '${{ vars.FACTORY_PROVIDER }}')
  assert.equal(step.env.FACTORY_API_URL, '${{ vars.FACTORY_API_URL }}')
  assert.equal(step.env.FACTORY_MODEL, '${{ vars.FACTORY_MODEL }}')
  assert.equal(step.env.FACTORY_API_KEY, '${{ secrets.FACTORY_API_KEY }}')
})

test('factory.yml: installs the dev dependencies and gives the factory a browser and the review model, for the screenshots of a visual change', () => {
  const list = steps(load('factory'), 'factory')
  const install = list.find((s) => s.run?.startsWith('npm ci'))
  assert.equal(install.run, 'npm ci', 'Astro (a dev dependency) is needed to render the candidate site')
  const step = list.find((s) => s.id === 'factory')
  assert.equal(step.env.FACTORY_BROWSER, 'google-chrome')
  assert.equal(step.env.FACTORY_REVIEW_MODEL, '${{ vars.FACTORY_REVIEW_MODEL }}')
  assert.equal(step.env.FACTORY_REVIEW_API_URL, '${{ vars.FACTORY_REVIEW_API_URL }}')
  assert.equal(step.env.FACTORY_REVIEW_API_KEY, '${{ secrets.FACTORY_REVIEW_API_KEY }}')
  assert.equal(step.env.FACTORY_API_KEY, '${{ secrets.FACTORY_API_KEY }}', 'the key stays in this step only')
})

test('gate.yml: triggers, stable job name and permissions', () => {
  const wf = load('gate')
  assert.deepEqual(Object.keys(wf.on).sort(), ['pull_request_review', 'pull_request_target'])
  assert.deepEqual(wf.on.pull_request_target.types, ['opened', 'synchronize', 'reopened', 'ready_for_review', 'closed'])
  assert.deepEqual(wf.on.pull_request_review.types, ['submitted', 'dismissed'])
  assert.deepEqual(Object.keys(wf.jobs), ['risk-gate', 'rerun-gate', 'mark-closed'])
  assert.deepEqual(wf.permissions, { contents: 'write', 'pull-requests': 'write' })
})

test('gate.yml: never checks out or runs the pull request head', () => {
  const wf = load('gate')
  // The job condition may read the head repo's name (to skip forks); nothing else may touch the head.
  const text = raw('gate').replaceAll('github.event.pull_request.head.repo.full_name == github.repository', '')
  assert.doesNotMatch(text, /pull_request\.head/)
  assert.doesNotMatch(text, /refs\/pull\//)
  assert.doesNotMatch(text, /github\.head_ref/)
  const checkouts = steps(wf, 'risk-gate').filter((s) => s.uses?.startsWith('actions/checkout@'))
  assert.equal(checkouts.length, 1)
  assert.equal(checkouts[0].with.ref, '${{ github.event.pull_request.base.ref }}')
})

test('no workflow interpolates expressions into run scripts (untrusted text goes through env)', () => {
  for (const name of ['gate', 'factory', 'ci', 'rebuild', 'deploy']) {
    for (const job of Object.values(load(name).jobs)) {
      for (const s of job.steps) {
        if (s.run) assert.doesNotMatch(s.run, /\$\{\{/, `${name}: run script interpolates an expression`)
      }
    }
  }
})

test('gate.yml: judges the PR, merges on merge=true, labels the human route, and fails when blocked', () => {
  const list = steps(load('gate'), 'risk-gate')
  const gate = list.find((s) => s.id === 'gate')
  assert.match(gate.run, /node scripts\/gate\.mjs --pr "\$PR"/)
  assert.equal(gate['continue-on-error'], true)
  const merge = list.find((s) => s.run?.includes('gh pr merge'))
  assert.match(merge.run, /--auto --squash --match-head-commit "\$HEAD"/)
  assert.equal(merge.env.HEAD, '${{ steps.gate.outputs.head }}')
  assert.equal(merge.if, "steps.gate.outputs.merge == 'true' && github.event.pull_request.draft != true")
  const human = list.find((s) => s.run?.includes('necesita-humano'))
  assert.equal(human.if, "steps.gate.outputs.route == 'human' && steps.gate.outputs.pass != 'true'", 'only a pull request still waiting for a person is labelled and asks for one')
  const last = list.at(-1)
  assert.match(last.if, /always\(\)/)
  assert.match(last.run, /exit 1/)
})

test('gate.yml: auto-merge is enabled as the factory App, so the merge closes the issue and deletes the branch', () => {
  const list = steps(load('gate'), 'risk-gate')
  const appIndex = list.findIndex((s) => s.uses?.startsWith('actions/create-github-app-token@'))
  const mergeIndex = list.findIndex((s) => s.run?.includes('gh pr merge'))
  const gateIndex = list.findIndex((s) => s.id === 'gate')
  assert.ok(appIndex > gateIndex && appIndex < mergeIndex, 'App token is minted after the verdict, before the merge')
  const app = list[appIndex]
  assert.equal(app.id, 'app')
  assert.equal(app.if, "steps.gate.outputs.merge == 'true' && github.event.pull_request.draft != true", 'the App key is only used when the gate decided to merge')
  assert.equal(app.with['app-id'], '${{ secrets.FACTORY_APP_ID }}')
  assert.equal(app.with['private-key'], '${{ secrets.FACTORY_APP_PRIVATE_KEY }}')
  assert.equal(list[mergeIndex].env.GH_TOKEN, '${{ steps.app.outputs.token }}')
})

test('ci.yml: pull_request and push to main run install, test and build in job "build"; a data-only PR skips the full suite', () => {
  const wf = load('ci')
  assert.ok('pull_request' in wf.on)
  assert.deepEqual(wf.on.push.branches, ['main'])
  assert.deepEqual(wf.permissions, { contents: 'read' })
  assert.deepEqual(Object.keys(wf.jobs), ['build'])
  // A burst of merges: a newer push to main (or to the same PR) cancels the run in progress.
  assert.deepEqual(wf.concurrency, { group: 'ci-${{ github.ref }}', 'cancel-in-progress': true })
  const all = steps(wf, 'build')
  assert.equal(all.find((s) => s.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 2, 'the merge ref and its base')
  assert.deepEqual(all.filter((s) => s.run).map((s) => s.run), ['npm ci', 'node scripts/ci-scope.mjs', 'npm test', 'npm run build'])
  assert.equal(all.find((s) => s.run === 'node scripts/ci-scope.mjs').id, 'scope')
  assert.equal(all.find((s) => s.run === 'npm test').if, "steps.scope.outputs.scope != 'datos'", 'fails closed: only an explicit datos skips it')
  assert.equal(all.find((s) => s.run === 'npm run build').if, undefined, 'the site is always validated and built')
})

test('every action is pinned to a major version', () => {
  for (const name of ['factory', 'gate', 'ci', 'rebuild', 'deploy']) {
    for (const job of Object.values(load(name).jobs)) {
      for (const s of job.steps.filter((s) => s.uses)) {
        assert.match(s.uses, /^[\w-]+\/[\w-]+@v\d+$/, `${name}: ${s.uses}`)
      }
    }
  }
})

test('gate.yml: the required check "risk-gate" is only produced by a judging pull request event, never by closing', () => {
  assert.equal(load('gate').jobs['risk-gate'].if, "github.event_name == 'pull_request_target' && github.event.action != 'closed'")
})

test('gate.yml: an approval re-runs the original risk-gate run instead of adding a second check with the same name', () => {
  const job = load('gate').jobs['rerun-gate']
  assert.equal(job.if, "github.event_name == 'pull_request_review' && github.event.pull_request.head.repo.full_name == github.repository")
  assert.deepEqual(job.permissions, { actions: 'write', 'pull-requests': 'read' })
  assert.equal(job.steps.filter((s) => s.uses).length, 0, 'no checkout, no actions: it only calls the API')
  const script = job.steps.map((s) => s.run ?? '').join('\n')
  assert.match(script, /--event pull_request_target/)
  assert.match(script, /gh run rerun "\$id"/)
  assert.equal(job.env.PR, '${{ github.event.pull_request.number }}')
})

// --- the task state in the issue body ---

test('factory.yml: the pull request number reaches the issue state only through the script', () => {
  const list = steps(load('factory'), 'factory')
  const pr = list.find((s) => s.id === 'pr')
  assert.match(pr.run, /number=/, 'the PR step exposes the number it created')
  const mark = list.find((s) => s.run?.includes('--pr'))
  assert.match(mark.run, /node scripts\/factory\.mjs --issue "\$ISSUE" --pr "\$PR_NUMBER"/)
  assert.equal(mark.env.PR_NUMBER, '${{ steps.pr.outputs.number }}')
  assert.match(mark.if, /steps\.pr\.outcome == 'success'|steps\.pr\.outputs\.number/)
  assert.ok(list.indexOf(mark) > list.indexOf(pr))
  for (const s of list) assert.doesNotMatch(s.run ?? '', /factory:state|gh api.*PATCH/, 'no workflow edits the state by hand')
})

test('factory.yml: still no expression in the mark step run script and the GitHub token is the default one', () => {
  const mark = steps(load('factory'), 'factory').find((s) => s.run?.includes('--pr'))
  assert.doesNotMatch(mark.run, /\$\{\{/)
  assert.equal(mark.env?.GH_TOKEN ?? '${{ github.token }}', '${{ github.token }}')
})

test('gate.yml: the judging job may write issues (to update the task state) and nothing else changed', () => {
  const job = load('gate').jobs['risk-gate']
  assert.deepEqual(job.permissions, { contents: 'write', 'pull-requests': 'write', issues: 'write' })
  const gate = steps(load('gate'), 'risk-gate').find((s) => s.id === 'gate')
  assert.match(gate.run, /node scripts\/gate\.mjs --pr "\$PR"/)
})

test('gate.yml: closing a PR does not cancel or share a run with the judgement', () => {
  const group = load('gate').concurrency.group
  assert.match(group, /github\.event\.action == 'closed'/)
})

test('gate.yml: mark-closed runs only on closed PRs of this repository, with the base commit, and merges nothing', () => {
  const wf = load('gate')
  const job = wf.jobs['mark-closed']
  assert.equal(job.if, "github.event_name == 'pull_request_target' && github.event.action == 'closed' && github.event.pull_request.head.repo.full_name == github.repository")
  assert.deepEqual(job.permissions, { contents: 'read', issues: 'write', 'pull-requests': 'read' })
  const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.base.sha }}')
  assert.equal(checkout.with['persist-credentials'], false)
  const run = job.steps.map((s) => s.run ?? '').join('\n')
  assert.match(run, /node scripts\/gate\.mjs --closed "\$PR"/)
  assert.doesNotMatch(run, /gh pr merge/)
  assert.equal(job.steps.some((s) => s.uses?.startsWith('actions/create-github-app-token@')), false, 'no App key')
  assert.equal(job.env.PR, '${{ github.event.pull_request.number }}')
})

test('every workflow takes Node from .node-version, and that version satisfies Astro', () => {
  const version = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim()
  const astro = JSON.parse(readFileSync(new URL('../node_modules/astro/package.json', import.meta.url), 'utf8')).engines.node
  const min = astro.match(/>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/).slice(1).map((n) => Number(n ?? 0))
  const have = version.split('.').map(Number)
  const ok = have[0] > min[0] || (have[0] === min[0] && have.length >= 3 && (have[1] > min[1] || (have[1] === min[1] && have[2] >= min[2])))
  assert.ok(ok, `.node-version ${version} does not satisfy astro ${astro}`)
  for (const name of ['ci', 'gate', 'factory', 'rebuild', 'deploy']) {
    for (const job of Object.values(load(name).jobs)) {
      for (const s of job.steps.filter((s) => s.uses?.startsWith('actions/setup-node@'))) {
        assert.equal(s.with['node-version-file'], '.node-version', `${name}: setup-node must read .node-version`)
        assert.equal(s.with['node-version'], undefined, `${name}: no hard-coded node-version`)
      }
    }
  }
})

test('factory.yml: no credential is left in .git/config; the push carries an explicit token that is never echoed', () => {
  const wf = load('factory')
  const all = steps(wf, 'factory')
  const checkout = all.find((s) => s.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with['persist-credentials'], false, 'the factory step runs with the model key: no token persisted in .git/config')
  const pr = all.find((s) => s.id === 'pr')
  assert.match(pr.run, /git push "https:\/\/x-access-token:\$\{GH_TOKEN\}@github\.com\/\$\{REPO\}\.git" "tarea\/\$ISSUE"/)
  assert.doesNotMatch(pr.run, /git push origin/)
  assert.equal(pr.env.GH_TOKEN, '${{ steps.app.outputs.token }}')
  assert.equal(pr.env.REPO, '${{ github.repository }}')
  for (const step of all) {
    assert.doesNotMatch(step.run ?? '', /echo[^\n]*(GH_TOKEN|x-access-token)|set -x|git remote (add|set-url)|git config[^\n]*(extraheader|credential)/, step.id ?? step.name)
  }
  // The guard reads the remote too, and no longer has the persisted credential: it passes the token explicitly as well.
  const guard = all.find((s) => s.id === 'guard')
  assert.match(guard.run, /git ls-remote --exit-code --heads "https:\/\/x-access-token:\$\{GH_TOKEN\}@github\.com\/\$\{GITHUB_REPOSITORY\}\.git" "tarea\/\$ISSUE"/)
  assert.doesNotMatch(guard.run, /ls-remote[^\n]* origin/)
})

test('workflows: every job runs Node 26 or newer, the one with the network switch the sandbox needs', () => {
  assert.ok(Number(readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim().split('.')[0]) >= 26)
  assert.match(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).engines.node, /26/)
})

test('CI never runs the tests a model wrote outside the sandbox: npm test covers src/ through runSuite only', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts
  assert.doesNotMatch(scripts.test, /src\//, 'npm test (CI, main) must not import src/domain or src/features tests directly')
  assert.match(scripts['test:src'], /src\/domain\/\*\.test\.mjs/, 'authors can still run them by hand')
  assert.equal(load('ci').jobs.build.steps.find((s) => s.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false)
  const baseline = readFileSync(new URL('./sandbox.test.mjs', import.meta.url), 'utf8')
  assert.match(baseline, /sandboxTest\('baseline: the repository suite/)
})

test('gate.yml: a draft pull request is judged but never merged; marking it ready judges it again', () => {
  const wf = load('gate')
  assert.ok(wf.on.pull_request_target.types.includes('ready_for_review'))
  const list = steps(wf, 'risk-gate')
  const notDraft = "steps.gate.outputs.merge == 'true' && github.event.pull_request.draft != true"
  assert.equal(list.find((s) => s.id === 'app').if, notDraft, 'no App token for a draft')
  assert.equal(list.find((s) => s.run?.includes('gh pr merge')).if, notDraft, 'no auto-merge for a draft')
})

test('rebuild.yml: after a push to main only, minimal permissions, one queue, the App token only in the script step', () => {
  const wf = load('rebuild')
  assert.deepEqual(wf.on.push, { branches: ['main'] })
  assert.deepEqual(Object.keys(wf.on).sort(), ['push', 'workflow_run'])
  assert.deepEqual(wf.permissions, { contents: 'read' })
  assert.deepEqual(wf.concurrency, { group: 'rebuild', 'cancel-in-progress': false })
  const list = steps(wf, 'rebuild')
  const checkout = list.find((s) => s.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with.ref, undefined, 'the pushed commit of main, never a pull request')
  assert.equal(checkout.with['persist-credentials'], false)
  const run = list.filter((s) => s.run)
  assert.deepEqual(run.map((s) => s.run), ['node scripts/rebuild.mjs'])
  assert.equal(run[0].env.GH_TOKEN, '${{ steps.app.outputs.token }}')
  assert.deepEqual(list.filter((s) => s.env?.GH_TOKEN).map((s) => s.run), ['node scripts/rebuild.mjs'])
  assert.equal(list.find((s) => s.id === 'app').with['private-key'], '${{ secrets.FACTORY_APP_PRIVATE_KEY }}')
  assert.equal(JSON.stringify(wf).includes('pull_request'.concat('_target')), false, 'no pull_request_target')
  assert.deepEqual(Object.keys(wf.on).filter((k) => k.startsWith('pull_request')), [], 'no pull request event')
})

test('rebuild.yml: also after the Factory workflow completes (a pull request that opens already conflicting), same queue', () => {
  const wf = load('rebuild')
  assert.deepEqual(wf.on.workflow_run, { workflows: ['Factory'], types: ['completed'] })
  assert.deepEqual(wf.on.push, { branches: ['main'] })
  assert.equal(wf.concurrency.group, 'rebuild')
  const checkout = steps(wf, 'rebuild').find((s) => s.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with.ref, undefined, 'main\'s code, never the head of the triggering run')
})

test('rebuild.yml: the App token is scoped to what the script writes', () => {
  const app = steps(load('rebuild'), 'rebuild').find((s) => s.uses?.startsWith('actions/create-github-app-token@'))
  assert.equal(app.with['permission-contents'], 'write')
  assert.equal(app.with['permission-pull-requests'], 'write')
  assert.equal(app.with['permission-issues'], 'write')
})

test('deploy.yml: every push to main deploys, a burst of merges ends in one or two deploys', () => {
  const wf = load('deploy')
  assert.deepEqual(wf.on.push, { branches: ['main'] })
  assert.ok('workflow_dispatch' in wf.on, 'the owner can redeploy by hand')
  assert.equal(wf.on.pull_request, undefined)
  assert.equal(wf.on.pull_request_target, undefined)
  assert.deepEqual(wf.permissions, { contents: 'read' })
  // A newer push cancels a build in progress; an upload in progress is never cut, only a pending one is replaced.
  assert.deepEqual(wf.jobs.build.concurrency, { group: 'deploy-build', 'cancel-in-progress': true })
  assert.deepEqual(wf.jobs.deploy.concurrency, { group: 'deploy-upload', 'cancel-in-progress': false })
  assert.equal(wf.jobs.deploy.needs, 'build')
})

test('deploy.yml: the build (which runs code a model wrote) has no secret; the upload holds the token and runs no repository code', () => {
  const wf = load('deploy')
  const text = raw('deploy')
  const build = steps(wf, 'build')
  assert.doesNotMatch(JSON.stringify(wf.jobs.build), /secrets\./, 'no secret in the build job')
  assert.equal(build.find((s) => s.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false)
  assert.ok(build.some((s) => s.run === 'npm ci'))
  assert.equal(build.find((s) => s.run === 'npm run build').env.TURNSTILE_SITE_KEY, '${{ vars.TURNSTILE_SITE_KEY }}', 'the form needs its public key at build time')
  const upload = build.find((s) => s.uses?.startsWith('actions/upload-artifact@'))
  assert.equal(upload.with.name, 'site')
  assert.equal(upload.with.path, 'dist')

  const deploy = steps(wf, 'deploy')
  assert.equal(deploy.find((s) => s.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false)
  assert.ok(deploy.find((s) => s.uses?.startsWith('actions/download-artifact@'))?.with.name === 'site')
  for (const s of deploy) assert.doesNotMatch(s.run ?? '', /npm (ci|install|run|test)|node /, 'no repository code runs next to the token')
  const run = deploy.find((s) => s.run?.includes('pages deploy'))
  assert.match(run.run, /npx --yes wrangler@\d+\.\d+\.\d+ pages deploy dist --project-name "\$PROJECT" --branch main --commit-hash "\$GITHUB_SHA"/)
  assert.equal(run.env.CLOUDFLARE_API_TOKEN, '${{ secrets.CLOUDFLARE_API_TOKEN }}')
  assert.equal(run.env.CLOUDFLARE_ACCOUNT_ID, '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}')
  assert.equal((text.match(/secrets\./g) ?? []).length, 2, 'the Cloudflare token and account are the only secrets')
})
