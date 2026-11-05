# Owner Report password

The Owner Report (admin sidebar → "Owner Report") shows real sales figures and
is protected by an owner password. The password is never stored in the code or
in plain text: the server keeps only a salted scrypt hash in the
`OWNER_PASSWORD_HASH` environment variable.

## Set or change the password

1. In the project folder run:
   `node scripts/make-owner-hash.mjs "your new owner password"`
   (at least 8 characters).
2. It prints one line: `OWNER_PASSWORD_HASH=scrypt:...:...`
3. Put that line in your local `.env` file (replace the old line), and in the
   Vercel project → Settings → Environment Variables (add/replace
   `OWNER_PASSWORD_HASH`), then redeploy.

Changing the value takes effect for the next unlock; an already-open report
still locks itself after 2 minutes of inactivity.

## Behavior

- Cashiers can only reach the POS screens (Rooms, Lounge, Staff Orders). The web
  server removes all sales history and revenue totals from everything it sends to
  a cashier's device.
- The report asks for the password every time it is opened, auto-locks after
  2 minutes without activity, and clears its data when you leave the page.
- 5 wrong passwords in a row blocks further tries for 60 seconds.
