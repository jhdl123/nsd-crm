# Next Step CRM (web app)

Front end for the Next Step Digital CRM. Plain HTML/CSS/JS (no build step). Data lives in Supabase project `nsd-crm` (ref `nbwfzdbtkgevksuixvhj`, London). The publishable key in `config.js` is safe to publish: row-level security only lets signed-in CRM members read or change anything.

## Files
- `index.html`, `app.css`, `app.js` – the app
- `config.js` – Supabase URL + publishable key
- `manifest.webmanifest`, `sw.js`, `icon*.png`, `icon.svg` – installable app (phone and laptop), offline shell
- `CNAME` – custom domain for GitHub Pages

## One-off setup (Joe)
1. **Host it.** Create a GitHub repo `nsd-crm`, upload these files, then Settings → Pages → Deploy from branch `main` / root. Custom domain: `crm.next-step-digital.co.uk`, tick Enforce HTTPS once offered.
2. **DNS at IONOS.** Add a CNAME record: host `crm` → `jhdl123.github.io`.
3. **Supabase → Authentication → URL Configuration.** Site URL: `https://crm.next-step-digital.co.uk`. Redirect URLs: add `https://crm.next-step-digital.co.uk/**`.
4. **Create your login.** Open the app → "First time? Create the owner account" → joe@ email + a long password → confirm via the email. The first account becomes the CRM owner automatically.
5. **Close the door.** Supabase → Authentication → Sign In / Providers → turn off "Allow new users to sign up".
6. **Optional, recommended:** turn on 2-step verification for your Supabase dashboard login (Account → Security).
7. **Install it.** Phone: open the site in Safari/Chrome → Share / menu → Add to Home Screen. Laptop: Chrome/Edge address bar → Install.

## How it behaves
- Loads everything at sign-in, keeps a copy in the browser for instant start and offline viewing, and updates live when anything changes in Supabase (including changes Claude makes).
- Edits save straight away. Offline edits are refused with a message rather than silently lost.
- Completing a recurring task creates the next one (database trigger).
- Activities update the company's "last contacted" (database trigger).
