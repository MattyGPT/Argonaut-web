/**
 * Shared browser launch for the optional regression checks and the guide
 * capture tool.
 *
 * Every check used to carry its own `chromium.launch({ channel: 'msedge' })`.
 * That pinned the whole suite to one vendor's browser at one install path, so
 * the checks could only ever be hand-run on a machine that happened to have
 * Edge — including in CI, which therefore ran none of them. This resolves a
 * Chromium-family browser once, in a documented order, and fails loudly with an
 * actionable message rather than skipping quietly: a green run that executed
 * nothing is precisely the failure this exists to prevent.
 *
 * Environment:
 *   PLAYWRIGHT_MODULE   module to require instead of playwright-core
 *   BROWSER_MANAGED=1   use only the playwright-managed browser that
 *                       `npx playwright install chromium` downloaded, ignoring
 *                       any system browser. This is what CI sets: it pins the
 *                       browser revision, so a geometry- or :focus-visible-
 *                       sensitive assertion cannot drift with whatever Chromium
 *                       the runner happens to have installed.
 *   BROWSER_EXECUTABLE  absolute path to a browser binary; wins over discovery
 *   BROWSER_CHANNEL     playwright channel name (chrome, msedge, ...); used
 *                       when no executable is named
 *   BROWSER_HEADFUL=1   show the browser window while debugging
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

/**
 * Discovery order, Edge first so a machine that validated these checks against
 * Edge keeps using it, then Chrome, then distro Chromium. GitHub's ubuntu
 * runners ship Chrome at the /opt path below, which is what CI resolves.
 */
export const KNOWN_EXECUTABLES = Object.freeze([
  '/opt/microsoft/msedge/msedge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/msedge',
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
]);

/** Channels playwright resolves by name on platforms whose install paths are
 * not listed above, such as macOS and Windows. */
export const KNOWN_CHANNELS = Object.freeze(['msedge', 'chrome']);

export const describeAttempt = (attempt) => attempt.executablePath
  ? `executablePath ${attempt.executablePath}`
  : attempt.channel ? `channel ${attempt.channel}` : 'playwright-managed browser';

/**
 * The ordered launch options to try. Pure, so it is testable without a browser.
 *
 * BROWSER_MANAGED short-circuits everything: it asks for the pinned revision
 * `npx playwright install chromium` downloaded, and nothing else. A named
 * BROWSER_EXECUTABLE or BROWSER_CHANNEL likewise short-circuits discovery — the
 * caller said which browser they want, so quietly substituting another one
 * would hide a typo or a missing binary behind someone else's success.
 */
export const launchAttempts = (env = process.env, exists = existsSync) => {
  const base = { headless: env.BROWSER_HEADFUL !== '1' };
  if (env.BROWSER_MANAGED === '1') return [base];
  if (env.BROWSER_EXECUTABLE) return [{ executablePath: env.BROWSER_EXECUTABLE, ...base }];
  if (env.BROWSER_CHANNEL) return [{ channel: env.BROWSER_CHANNEL, ...base }];
  return [
    ...KNOWN_EXECUTABLES.filter((executablePath) => exists(executablePath)).map((executablePath) => ({ executablePath, ...base })),
    ...KNOWN_CHANNELS.map((channel) => ({ channel, ...base })),
    base,
  ];
};

const firstLine = (error) => String(error?.message ?? error).split('\n')[0];

/**
 * Launch a browser, or throw one error naming everything that was tried.
 * Returns the browser so callers keep their existing try/finally close.
 */
export const launchBrowser = async (env = process.env) => {
  const moduleName = env.PLAYWRIGHT_MODULE || 'playwright-core';
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = require(moduleName));
  } catch (error) {
    throw new Error(`Cannot require ${moduleName} (${firstLine(error)}). Run \`npm ci\`, or set PLAYWRIGHT_MODULE to an existing installation.`);
  }
  const failures = [];
  for (const attempt of launchAttempts(env)) {
    try {
      return { browser: await chromium.launch(attempt), via: describeAttempt(attempt) };
    } catch (error) {
      failures.push(`${describeAttempt(attempt)}: ${firstLine(error)}`);
    }
  }
  throw new Error(`No usable Chromium-family browser. Set BROWSER_EXECUTABLE=/path/to/browser or BROWSER_CHANNEL=chrome.\nTried:\n  ${failures.join('\n  ')}`);
};
