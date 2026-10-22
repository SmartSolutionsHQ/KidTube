# Upgrading

Two situations are covered here: updating a KidTube install to a newer version, and moving an older family site
built on the KidTube starter onto the current app. Both keep your videos, accounts and comments.

## Before any upgrade

1. **Read the changelog.** [CHANGELOG.md](../CHANGELOG.md) says what changed and whether anything needs doing.
2. **Make a backup you could restore by hand.** Stop the app and copy the whole data folder, or follow
   [OPERATIONS.md](OPERATIONS.md#back-up-and-restore). The data folder holds the database, the videos, the kids'
   badges and the signing key (`secret`).
3. **Pick a quiet time.** Uploads in progress are marked failed when the app restarts; the uploader can send the
   video again.

## Updating KidTube

With Docker:

```bash
cd kidtube
git pull
docker compose up -d --build
docker logs kidtube
```

Add `-f compose.yaml -f compose.https.yaml` to the `up` command if you use the included Caddy. With Node, stop the
app, `git pull`, and start it again with `npm start`.

### What happens on the first start

The database carries a version number. When the new app starts on an older database it:

1. **copies the database first**, to `backups/pre-migrate-v<old version>-<date and time>.sqlite` inside the data
   folder (in Docker, inside the `kidtube-data` volume), using SQLite's own backup so the copy is consistent;
2. upgrades the database one step at a time, each step all-or-nothing;
3. starts as usual.

An install that already has a parent account never goes back into setup. Settings you set in `.env` still win
over the ones saved in the dashboard.

If the app refuses to start with "Database is newer than this app", the database was already upgraded by a newer
version. Update the app instead of rolling the data back.

### Rolling back

If the new version misbehaves:

1. Stop the app (`docker compose down`, or stop `npm start`).
2. Check out the version you had before (`git log` shows it; `git checkout <that commit or version tag>`), and
   rebuild it (`docker compose build`).
3. Put the backup back as the database. In the data folder, move `kidtube.sqlite` (and any `kidtube.sqlite-wal`
   and `kidtube.sqlite-shm` next to it) somewhere safe, then copy
   `backups/pre-migrate-v<old version>-<date>.sqlite` to `kidtube.sqlite`.

   With the Docker volume (`kidtube_kidtube-data` for an install folder called `kidtube`; `docker volume ls`
   shows it), one way is a throwaway container that mounts it:

   ```bash
   docker run --rm -it -v kidtube_kidtube-data:/data alpine sh
   # inside it:
   cd /data && mkdir -p rollback && mv kidtube.sqlite* rollback/
   cp backups/pre-migrate-v3-*.sqlite kidtube.sqlite && chown 1000:1000 kidtube.sqlite && exit
   ```

4. Start the older version. Check that you can sign in and play a video before deleting anything.

Anything added after the upgrade (new videos, comments, accounts) is not in the backup. Video files uploaded since
stay in `videos/` but no longer appear; re-upload any you want to keep.

## Moving an older family site onto KidTube

Some families run a site built from the earlier one-channel KidTube starter, or from code it was based on: one
channel, a `.env` with `SIGN_SECRET`, and a `data/` folder next to the app. The current app can take over that
data in place. The site's videos become the first kid's channel.

### What carries over

- Every account, with its password and approval. Parents stay parents; approved viewers stay approved.
- Every video, its title, likes and comments, in the same order, on the first kid's channel.
- Guest codes that haven't expired.
- Sign-ins, as long as you keep the same `SIGN_SECRET` (or `data/secret`). A new secret signs everyone out.

Comments stay open as they were (an older site had no comment review), and the setup wizard does not run again.

### Steps

1. **Try it on a copy first.** Copy the old site's folder (its `.env` and `data/`) to a scratch place on another
   computer or port and do the steps below there. Only touch the real site once the copy looks right.
2. **Stop the old site** and make a full copy of `data/` and `.env`.
3. **Put the new app next to the data.** Either clone KidTube into a new folder and move the old `.env` and
   `data/` into it, or update the old folder's code to the new version.
4. **Keep using the folder, not a new volume.** The new `compose.yaml` stores data in a Docker volume by default,
   which would start empty and go straight into setup. Add this line to `.env` before the first start:

   ```text
   KIDTUBE_DATA=./data
   ```

   The folder must belong to the user the app runs as (1000:1000 by default, or set `PUID` and `PGID`). If it
   doesn't, the log prints the exact `chown` command.
5. **Start it** with `docker compose up -d --build` (or `npm start`) and read `docker logs kidtube`. You should see
   it listening, with no setup code. A `pre-migrate-v0-…` or `pre-migrate-v1-…` backup appears in
   `data/backups/`.
6. **Make it yours.** Sign in at `/parents` with the old parent account:
   - Kids: rename the first channel to your kid, pick a colour and an intro, build a badge, and add more kids.
   - Settings: the family name, line, colour and family badge (it becomes the home-screen icon).
   - Who can watch: decide whether new comments wait for you, and whether the front door shows the kids.
7. **Check from outside.** In a browser that isn't signed in: the front door opens, videos ask for a sign-in, and
   an approved viewer can sign in and play a video.
8. **Tell the family** about the home-screen app at `/install`, and that iPhones sign in once more in the
   home-screen app.

If anything looks wrong, stop the new app and put the copy from step 2 back; the old code runs on it as before.

### Older sites with videos stored in the database

The very first versions of the starter kept small videos inside the database rather than in `data/videos/`.
Those still play: the app keeps serving them from the database, and nothing needs converting.
