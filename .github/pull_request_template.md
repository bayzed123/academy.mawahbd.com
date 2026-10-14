## What and why
<!-- One or two sentences a non-developer could follow. -->

## How to check it
<!-- Steps, or which automated test covers it. -->

## Checklist
- [ ] `npm run typecheck` and `npm test` pass
- [ ] New or changed screens work in **Bangla and English** and on a phone (360 px wide)
- [ ] No secret, API key or real customer data in the diff (use `worker/.dev.vars`, never commit it)
- [ ] Database changes are a **new** numbered file in `worker/migrations/` (never edit an applied one)
- [ ] No invented numbers on the site (enrolment, viewer or rating counts must come from real data)
