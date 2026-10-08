# Publishing TCGEngrave

The site runs on **Render**, which takes the code from this GitHub repo and redeploys it every time
you `git push`. Git delivers the code; Render runs the site.

Cost: Render Starter instance (about US$7/month) + a 1 GB disk (about US$0.25/month) + a domain
(about US$10–15/year for a `.com`).

## 1. Buy a domain

Use a registrar such as **Cloudflare Registrar** (sold at cost), **Namecheap** or **Porkbun**.
`.sg` domains need a Singapore registrant and cost more.

## 2. Push the code

```
git add -A
git commit -m "Ready to publish"
git push
```

The `.env` file (your Supabase key) is never pushed. You'll paste the key into Render instead.

## 3. Create the site on Render

1. Go to [render.com](https://render.com) and sign in with GitHub.
2. **New → Web Service**, then pick the `pokemonbinder` repository.
3. Settings:
   - **Region:** Singapore
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Starter. A disk needs a paid instance.
4. **Environment variables:**
   - `SUPABASE_SERVICE_ROLE_KEY`: the key from your `.env` file
   - `STORAGE_DIR`: `/var/data`
5. **Disk:** add a disk with mount path `/var/data`, size 1 GB.
6. Click **Deploy**. When it's live, open `https://<your-service>.onrender.com` and check the shop.

On first start the server copies the designs from the repo onto the disk. From then on, designs
you upload on the live admin page are saved on that disk.

## 4. Connect your domain

1. In Render: your service → **Settings → Custom Domains** → add `yourdomain.com` and
   `www.yourdomain.com`.
2. At your registrar, add the DNS records Render shows you: a **CNAME** for `www`, and an
   **ALIAS/ANAME** or **A** record for the root domain.
3. Render turns on HTTPS automatically once the DNS works. That takes from a few minutes to a few
   hours.

## 5. Update Supabase

Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL:** `https://yourdomain.com`
- **Redirect URLs:** add `https://yourdomain.com/**`. Keep `http://localhost:3000/**` for testing
  on your computer.

Without this, sign-up confirmation and password-reset emails link to `localhost`.

## 6. Before real customers

- **Email:** set up your own email provider (SMTP) in Supabase → **Authentication → Emails**.
  Supabase's built-in email is for testing only.
- **Admins:** make your account an admin with the SQL at the end of `supabase/schema.sql`.

## Day to day

- **Code changes:** `git push`, and Render redeploys in about a minute.
- **Designs** uploaded on the live admin page live on Render's disk, not in git. Your local copy
  and the live site will differ, and that's expected: the live site is the real shop.
- **Backups:** Render keeps daily snapshots of the disk.
- **Logs:** if something goes wrong, check the **Logs** tab of the service on Render.
