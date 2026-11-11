# Test account (for Claude sessions)

Use the shared trial test account for end-to-end checks of login, onboarding,
pricing and checkout. It is a real account in the project's auth system, so use
it only for testing and never change another user's data.

## Credentials are never stored in this repo

Read them from environment variables set in the cloud environment's secrets:

- `CAMCASH_TEST_EMAIL`
- `CAMCASH_TEST_PASSWORD`

If these variables are missing, stop and ask the owner to add them in the
environment settings. Do not ask for the password in chat, and never write it to
a file, commit, PR, log or screenshot caption.

## Rules

- Confirm the target Supabase project is the test or staging project before any
  write. Never run writes against production with this account.
- Do not delete or edit real users' data.
- Do not use this account to make real payments. Use Stripe test mode only.
