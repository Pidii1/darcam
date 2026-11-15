Darcam for Vercel
=================
This folder is the Darcam web version ready for Vercel.
- api/yt.js, api/jam.js, api/lyrics.js do the job of yt.php, jam.php and lyrics_proxy.php.
- vercel.json sends /yt.php, /jam.php and /lyrics_proxy.php to them, so the app works the same.
- Jam needs Upstash Redis: Vercel project -> Storage -> Upstash (Redis) -> Connect. Then redeploy.
- Darcam-2_5_5.apk sits next to index.html, so Android updates download from here.
- Windows .msi is too big for Vercel: put it on GitHub Releases named Darcam-Setup.msi,
  then change GITHUB-NAME in version.json to your GitHub username.
