/**
 * Multi-user collaboration spec — verifies two users sign in into
 * separate browser contexts and the app distinguishes them.
 *
 * `users(2)` takes any two accounts from your pool, so this spec passes on a
 * fresh app with no setup beyond having two test accounts:
 *   npx deepspace test accounts list
 *   npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin
 *
 * Ask for accounts *by name* (`users(['Alice', 'Bob'])`) only when the
 * behaviour under test depends on which identity acts — otherwise naming them
 * couples the spec to one machine's pool.
 *
 * The `users` fixture handles sign-in caching (per-account storageState
 * persisted to `~/.deepspace/playwright-states/`), context creation, and
 * cleanup. No need to manage browser contexts manually.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

// A machine that has never created test accounts is the normal state of a
// fresh checkout, and there `users()` throws — turning "you have no pool yet"
// into three red tests about the app, which it is not. Skip the file instead
// and say what creates the pool. The count is of accounts usable HERE: the
// pool is global per developer, but passwords live only on the machine that
// created the account.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)

  // /home is dynamic (under src/pages/(app)/), so it mounts the nav shell;
  // '/' is the static landing and has no navigation.
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  // Email, not name. The page renders the *session's* `name || email`, while
  // `user.name` here comes from the LOCAL account registry — and the two are
  // not the same fact: a display name is optional, and an account recovered on
  // another machine has none stored locally at all. The email is the credential
  // the context signed in with, so it is the one identity both sides agree on,
  // and asserting it proves the page is showing THIS browser's account.
  // The two accounts are distinct, so two exact matches is also the proof that
  // the contexts are not sharing one session.
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    // The identity chip shows `name || email`. Its text is not predictable, but
    // its presence is: something must be there once the profile has loaded.
    // (It is `hidden sm:inline` in some templates, so assert text, not
    // visibility.)
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('API status page renders loading success and error states', async ({ users }) => {
  const [user] = await users(1)
  let shouldFail = false
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    if (shouldFail) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
      })
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { integrations: { openai: {}, wikipedia: {} } } }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()
  await expect(user.page.getByText('2 integrations available.')).toBeVisible()

  shouldFail = true
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect(user.page.getByText('Catalog unavailable')).toBeVisible()
  await expect(user.page.getByText('Showing the last loaded catalog')).toBeVisible()
  await expect(user.page.getByText('Integration catalog ready')).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await user.page.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

test('API status page shows local retry after first-load API failure', async ({ users }) => {
  const [user] = await users(1)
  let requestCount = 0

  await user.page.route('**/api/integrations', async (route) => {
    requestCount += 1
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'Catalog unavailable' }),
    })
  })

  await user.page.goto('/api-status')
  await expect(user.page.getByText('Loading integration catalog...')).toBeVisible()
  await expect(user.page.getByText('Could not load API data')).toBeVisible()
  await expect(user.page.getByText('Retried 1 time automatically.')).toBeVisible()

  const retryButton = user.page.getByRole('button', { name: 'Retry' })
  await expect(retryButton).toBeVisible()

  const urlAfterFailure = user.page.url()
  const requestsAfterFailure = requestCount
  await retryButton.click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsAfterFailure)
  expect(user.page.url()).toBe(urlAfterFailure)
})

/** Call a server action from inside a signed-in page, the way the app does. */
async function callAction<T>(page: import('@playwright/test').Page, name: string, params: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, params }) => {
      const tokenRes = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const { token } = (await tokenRes.json()) as { token: string }
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return res.json()
    },
    { name, params },
  ) as Promise<{ success: boolean; data?: T; error?: string }>
}

test('team review: presence, no self-review, live sign-off and discussion', async ({ users }) => {
  const [author, reviewer] = await users(2)
  await author.page.goto('/home')
  await expect(author.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

  // A finished check with pre-written verdicts (dev-only action, no model calls).
  const seeded = await callAction<{ checkId: string; claimIds: string[] }>(author.page, 'seedDemoCheck', {
    title: `__test-${Date.now()}__ review flow`,
  })
  expect(seeded.success, seeded.error).toBe(true)
  const { checkId, claimIds } = seeded.data!

  await Promise.all([author.page.goto(`/checks/${checkId}`), reviewer.page.goto(`/checks/${checkId}`)])
  const authorCards = author.page.getByTestId('claim-card')
  const reviewerCards = reviewer.page.getByTestId('claim-card')
  await expect(authorCards).toHaveCount(2, { timeout: 15_000 })
  await expect(reviewerCards).toHaveCount(2, { timeout: 15_000 })

  // Presence: each sees that someone else has the check open.
  await expect(author.page.getByTestId('viewers-bar')).toContainText('Also viewing', { timeout: 15_000 })
  await expect(reviewer.page.getByTestId('viewers-bar')).toContainText('Also viewing', { timeout: 15_000 })

  // The author gets no review controls, and the server refuses a direct call too.
  await expect(authorCards.first().getByText('You ran this check, so a teammate reviews it.')).toBeVisible()
  await expect(authorCards.first().getByRole('button', { name: 'Agree', exact: true })).toHaveCount(0)
  const selfReview = await callAction(author.page, 'reviewClaim', { claimId: claimIds[0], decision: 'agree' })
  expect(selfReview.success).toBe(false)
  expect(selfReview.error).toContain('teammate')

  // The reviewer signs off claim 1; the author sees it live.
  await reviewerCards.first().getByRole('button', { name: 'Agree', exact: true }).click()
  await expect(author.page.getByTestId('review-progress')).toContainText('1/2 signed off', { timeout: 15_000 })

  // The reviewer disputes claim 2 with their own verdict and a note.
  await reviewerCards.nth(1).getByRole('button', { name: 'Disagree' }).click()
  await reviewerCards.nth(1).getByRole('combobox').click()
  await reviewer.page.getByRole('option', { name: 'Unverifiable' }).click()
  await reviewerCards.nth(1).getByPlaceholder('Why? (optional)').fill('Compliance claims belong on the trust page, not the docs.')
  await reviewerCards.nth(1).getByRole('button', { name: 'Save review' }).click()
  await expect(author.page.getByTestId('review-progress')).toContainText('1 disputed', { timeout: 15_000 })
  await expect(authorCards.nth(1)).toContainText('Compliance claims belong on the trust page', { timeout: 15_000 })

  // A disagreement must name a different verdict (validated server-side).
  const sameVerdict = await callAction(reviewer.page, 'reviewClaim', {
    claimId: claimIds[1],
    decision: 'disagree',
    verdict: 'not_in_docs',
  })
  expect(sameVerdict.success).toBe(false)

  // Discussion: the author comments, the reviewer sees it without reloading.
  const comment = `__test-${Date.now()}__ can we cite the trust page instead?`
  await author.page.locator('#discussion-input').fill(comment)
  await author.page.getByRole('button', { name: 'Comment' }).click()
  await expect(reviewer.page.getByTestId('discussion')).toContainText(comment, { timeout: 15_000 })
})

test('a claim flagged by the weekly re-check shows the docs-changed warning', async ({ users }) => {
  const [user] = await users(1)
  await user.page.goto('/home')
  await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  const seeded = await callAction<{ checkId: string }>(user.page, 'seedDemoCheck', {
    title: `__test-${Date.now()}__ stale claim`,
    stale: true,
  })
  expect(seeded.success, seeded.error).toBe(true)

  await user.page.goto(`/checks/${seeded.data!.checkId}`)
  await expect(user.page.getByTestId('stale-count')).toHaveText('1 stale', { timeout: 15_000 })
  const cards = user.page.getByTestId('claim-card')
  await expect(cards.first().getByTestId('stale-warning')).toContainText('The docs changed.')
  await expect(cards.nth(1).getByTestId('stale-warning')).toHaveCount(0)
})
