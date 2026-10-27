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

test('gate.yml: triggers, stable job name and permissions', () => {
  const wf = load('gate')
  assert.deepEqual(Object.keys(wf.on).sort(), ['pull_request_review', 'pull_request_target'])
  assert.deepEqual(wf.on.pull_request_target.types, ['opened', 'synchronize', 'reopened'])
  assert.deepEqual(wf.on.pull_request_review.types, ['submitted', 'dismissed'])
  assert.deepEqual(Object.keys(wf.jobs), ['risk-gate'])
  assert.deepEqual(wf.permissions, { contents: 'write', 'pull-requests': 'write' })
})

test('gate.yml: never checks out or runs the pull request head', () => {
  const wf = load('gate')
  // The job condition may read the head repo's name (to skip forks); nothing else may touch the head.
  const text = raw('gate').replace('github.event.pull_request.head.repo.full_name == github.repository', '')
  assert.doesNotMatch(text, /pull_request\.head/)
  assert.doesNotMatch(text, /refs\/pull\//)
  assert.doesNotMatch(text, /github\.head_ref/)
  const checkouts = steps(wf, 'risk-gate').filter((s) => s.uses?.startsWith('actions/checkout@'))
  assert.equal(checkouts.length, 1)
  assert.equal(checkouts[0].with.ref, '${{ github.event.pull_request.base.ref }}')
})

test('no workflow interpolates expressions into run scripts (untrusted text goes through env)', () => {
  for (const name of ['gate', 'factory', 'ci']) {
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
  assert.equal(merge.if, "steps.gate.outputs.merge == 'true'")
  const human = list.find((s) => s.run?.includes('necesita-humano'))
  assert.equal(human.if, "steps.gate.outputs.route == 'human'")
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
  assert.equal(app.if, "steps.gate.outputs.merge == 'true'", 'the App key is only used when the gate decided to merge')
  assert.equal(app.with['app-id'], '${{ secrets.FACTORY_APP_ID }}')
  assert.equal(app.with['private-key'], '${{ secrets.FACTORY_APP_PRIVATE_KEY }}')
  assert.equal(list[mergeIndex].env.GH_TOKEN, '${{ steps.app.outputs.token }}')
})

test('ci.yml: pull_request and push to main run install, test and build in job "build"', () => {
  const wf = load('ci')
  assert.ok('pull_request' in wf.on)
  assert.deepEqual(wf.on.push.branches, ['main'])
  assert.deepEqual(wf.permissions, { contents: 'read' })
  assert.deepEqual(Object.keys(wf.jobs), ['build'])
  const runs = steps(wf, 'build').filter((s) => s.run).map((s) => s.run)
  assert.deepEqual(runs, ['npm ci', 'npm test', 'npm run build'])
})

test('every action is pinned to a major version', () => {
  for (const name of ['factory', 'gate', 'ci']) {
    for (const job of Object.values(load(name).jobs)) {
      for (const s of job.steps.filter((s) => s.uses)) {
        assert.match(s.uses, /^[\w-]+\/[\w-]+@v\d+$/, `${name}: ${s.uses}`)
      }
    }
  }
})

test('gate.yml: review events only run for same-repository pull requests', () => {
  const job = load('gate').jobs['risk-gate']
  assert.equal(job.if, "github.event_name != 'pull_request_review' || github.event.pull_request.head.repo.full_name == github.repository")
})
