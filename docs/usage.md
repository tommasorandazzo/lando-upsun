# Upsun

`@lando/upsun` provides a `upsun` recipe for running Drupal or WordPress projects hosted on [Upsun](https://upsun.com) locally, and for pulling their database and files down from a real Upsun environment.

## Getting started

```yaml
name: my-app
recipe: upsun
config:
  php: '8.3'
  framework: drupal
  webroot: web
  database: 'mysql:8.0'
```

Run `lando start` and then `lando pull` to grab data from Upsun. See the main [README](../README.md) for the full config reference and pull usage.

## Roadmap / known gaps

- **No `lando push`.** Pull-only for now; push (sending local db/files back up to an environment) may be added later.
- **No `lando init --source upsun`.** You're expected to already have a codebase checked out; this recipe doesn't scaffold one for you.
- **No multi-service topology mirroring.** If your Upsun app has more than one application container or extra services (search, queues, etc.), add them to `.lando.yml` yourself — this recipe only manages one appserver and one database, same as the Pantheon and Acquia recipes.
