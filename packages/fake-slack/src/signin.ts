/**
 * The sign-in page and the "client" page. Together they do what the real
 * sign-in does from Juno's point of view: set the `d` cookie and store the
 * token in `localStorage.localConfig_v2` (research section 1).
 */

export function signInPage(options: { readonly error?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sign in to Juno Fake</title>
<style>
  body { font: 15px -apple-system, system-ui, sans-serif; margin: 0; padding: 48px; background: #f8f7f3; color: #1b1c15; }
  form { max-width: 320px; display: grid; gap: 12px; }
  input { font: inherit; padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; }
  button { font: inherit; padding: 8px 12px; border: 0; border-radius: 6px; background: #1b1c15; color: #fff; }
  .error { color: #b00020; }
</style>
</head>
<body>
<h1>Sign in to Juno Fake</h1>
<p>Any email and password work.</p>
${options.error === undefined ? '' : `<p class="error">${options.error}</p>`}
<form method="post" action="/signin">
  <input name="email" type="email" placeholder="Email" autocomplete="username" required>
  <input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
</form>
</body>
</html>
`
}

export interface ClientPageOptions {
  readonly teamId: string
  readonly teamName: string
  readonly domain: string
  readonly url: string
  readonly token: string
  readonly userId: string
}

/** Writes `localConfig_v2` the way the real client page does, then shows a minimal shell. */
export function clientPage(options: ClientPageOptions): string {
  const localConfig = {
    teams: {
      [options.teamId]: {
        id: options.teamId,
        name: options.teamName,
        domain: options.domain,
        url: options.url,
        token: options.token,
        user_id: options.userId,
        user_locale: 'en-US',
        variant: 'commercial',
      },
    },
    lastActiveTeamId: options.teamId,
    orderedTeamIds: [options.teamId],
    recentlyUsedTeamIds: [options.teamId],
    lastFetched: Date.now(),
  }
  return `<!doctype html>
<html lang="en" data-app="client-v2" data-app-name-override="client">
<head>
<meta charset="utf-8">
<title>${options.teamName} - Juno Fake</title>
<script>
  localStorage.setItem('localConfig_v2', ${JSON.stringify(JSON.stringify(localConfig))});
</script>
</head>
<body>
<h1>${options.teamName}</h1>
<p id="status">Signed in as ${options.userId}.</p>
</body>
</html>
`
}
