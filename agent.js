import 'dotenv/config';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import Groq from 'groq-sdk';

const required = ['GROQ_API_KEY', 'GITHUB_TOKEN', 'REPO_OWNER', 'REPO_NAME'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const config = {
  owner: process.env.REPO_OWNER,
  repo: process.env.REPO_NAME,
  baseBranch: process.env.BASE_BRANCH ?? 'main',
  targetFile: process.env.TARGET_FILE ?? 'selfUpdatingWeb.html',
  model: process.env.GROQ_MODEL ?? 'qwen/qwen3.8-27b',
  maxTokens: Number(process.env.GROQ_MAX_TOKENS ?? 900),
  intervalMs: Number(process.env.INTERVAL_MINUTES ?? 1) * 60_000,
  checkIntervalMs: Number(process.env.CHECK_INTERVAL_SECONDS ?? 10) * 1_000,
  checkTimeoutMs: Number(process.env.CHECK_TIMEOUT_MINUTES ?? 10) * 60_000,
  autoMerge: process.env.AUTO_MERGE === 'true'
};

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  maxRetries: 2,
  timeout: 60_000
});
let cycleRunning = false;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function generatePage(timestamp) {
  const currentPage = fs.readFileSync(config.targetFile, 'utf8');
  const request = {
    model: config.model,
    temperature: 0.8,
    max_tokens: config.maxTokens,
    messages: [
      {
        role: 'system',
        content: [
          'You are an autonomous web developer.',
          `Return only a complete HTML document for ${config.targetFile}.`,
          'Keep all CSS and JavaScript inline. Preserve accessibility, responsive behavior, and an interactive feature.',
          'Do not include markdown fences, external scripts, secrets, or network calls.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `Redesign this page with a fresh visual direction. Timestamp: ${timestamp}. Current page:\n${currentPage}`
      }
    ]
  };

  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await groq.chat.completions.create(request);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      const delay = error.status === 429 ? 20_000 : attempt * 5_000;
      console.warn(`Groq request failed (attempt ${attempt}/3): ${error.message}. Retrying in ${delay / 1_000}s.`);
      await sleep(delay);
    }
  }

  const content = response.choices[0]?.message?.content?.trim();
  if (!content || !content.toLowerCase().includes('<!doctype html>')) {
    throw new Error('AI response did not contain a complete HTML document.');
  }
  return content.replace(/^```html\s*/i, '').replace(/```\s*$/, '').trim();
}

async function waitForChecks(prNumber, branchName) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < config.checkTimeoutMs) {
    await sleep(config.checkIntervalMs);
    const [{ data: status }, { data: checks }] = await Promise.all([
      octokit.rest.repos.getCombinedStatusForRef({ owner: config.owner, repo: config.repo, ref: branchName }),
      octokit.rest.checks.listForRef({ owner: config.owner, repo: config.repo, ref: branchName })
    ]);
    const states = [
      ...status.statuses.map(({ state }) => state),
      ...checks.check_runs.map(({ status: runStatus, conclusion }) => conclusion ?? runStatus)
    ];
    console.log(`PR #${prNumber} checks: ${states.join(', ') || 'none'}`);
    if (states.some((state) => ['failure', 'error', 'cancelled', 'timed_out'].includes(state))) {
      throw new Error(`PR #${prNumber} failed status checks.`);
    }
    if (states.length === 0 || states.every((state) => state === 'success')) return;
  }
  throw new Error(`Timed out waiting for PR #${prNumber} checks.`);
}

async function runAutonomousCycle() {
  if (cycleRunning) {
    console.log('Skipping cycle because the previous cycle is still running.');
    return;
  }
  cycleRunning = true;
  const timestamp = Date.now();
  const branchName = `ai-update-${timestamp}`;
  try {
    console.log(`Starting autonomous cycle on ${branchName}`);
    git(['checkout', config.baseBranch]);
    git(['pull', '--ff-only', 'origin', config.baseBranch]);
    git(['checkout', '-b', branchName]);
    fs.writeFileSync(config.targetFile, await generatePage(timestamp));
    git(['add', config.targetFile]);
    git(['commit', '-m', `feat(ai): autonomous update ${timestamp}`]);
    git(['fetch', 'origin', config.baseBranch]);
    git(['rebase', `origin/${config.baseBranch}`]);
    git(['push', '--set-upstream', 'origin', branchName]);

    const { data: pr } = await octokit.rest.pulls.create({
      owner: config.owner,
      repo: config.repo,
      title: `Autonomous AI design update - ${timestamp}`,
      head: branchName,
      base: config.baseBranch,
      body: 'Automated redesign generated by the autonomous web agent.'
    });
    console.log(`PR #${pr.number} created.`);
    await waitForChecks(pr.number, branchName);

    if (config.autoMerge) {
      await octokit.rest.pulls.merge({
        owner: config.owner,
        repo: config.repo,
        pull_number: pr.number,
        merge_method: 'rebase'
      });
      console.log(`PR #${pr.number} merged into ${config.baseBranch}.`);
    } else {
      console.log(`PR #${pr.number} passed checks. AUTO_MERGE is disabled.`);
    }
  } catch (error) {
    console.error(`Cycle failed: ${error.message}`);
  } finally {
    try {
      git(['checkout', config.baseBranch]);
      git(['branch', '-D', branchName]);
    } catch (cleanupError) {
      console.error(`Cleanup failed: ${cleanupError.message}`);
    }
    cycleRunning = false;
  }
}

await runAutonomousCycle();
setInterval(runAutonomousCycle, config.intervalMs);
