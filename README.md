# @lando/upsun

An unofficial [Lando](https://docs.lando.dev) recipe for Drupal and WordPress projects hosted on [Upsun](https://upsun.com) (formerly Platform.sh).

This is a lean recipe: one PHP appserver + one database service, closely following the shape of the official `@lando/pantheon` and `@lando/acquia` recipes. It does **not** try to mirror your project's full `.upsun/config.yaml` service topology the way the old, unsupported `@lando/platformsh` recipe did — if you need extra services (search, queues, additional apps), add them to your `.lando.yml` as you would for any Lando app.

The main feature is `lando pull`: grabbing the database and file mounts from a real Upsun environment into your local containers.

## Status

This is a personal recipe, built for local use and as a candidate for eventual submission to the `lando` GitHub org. Not yet published to npm.

**In v1:**
- `lando pull` — database + file mounts from an Upsun environment
- `drush`/`wp` tooling depending on `framework`
- `mysql`/`psql` tooling depending on `database`
- `upsun` tooling — raw passthrough to the official CLI (e.g. `lando upsun environments`)

**Not yet implemented** (see [docs/usage.md](docs/usage.md) for details and rationale):
- `lando push`
- `lando init --source upsun` scaffolding

## Requirements

- An existing Drupal or WordPress codebase already connected to an Upsun project (i.e. you can already run `upsun` CLI commands against it, or plan to authenticate via `lando pull`).
- An [Upsun API token](https://developer.upsun.com/cli/api-tokens) if you want to pull data.

## Usage

Add this to your project's `.lando.yml` while developing/testing locally (until this is published as `@lando/upsun`):

```yaml
name: my-app
recipe: upsun
config:
  php: '8.3'
  framework: drupal   # or wordpress
  webroot: web         # docroot relative to the project root
  database: 'mysql:8.0' # or e.g. 'postgres:16'

plugins:
  "@lando/upsun": /path/to/lando-upsun
```

Then:

```bash
lando start
lando pull
```

`lando pull` will prompt for:
- an **Upsun API token** (cached locally after first use, so you won't be asked every time)
- an **environment** (defaults to your current git branch, matching how Upsun maps environments to branches)
- **relationship(s)** to import as the local database (defaults to `database`; comma-separated, or `none` to skip)
- **mount(s)** to download (defaults to the framework's public files directory; comma-separated `source[:target]` pairs, or `none` to skip)

Non-interactively:

```bash
lando pull --auth "$UPSUN_CLI_TOKEN" -e main -r database -m web/sites/default/files
```

See [examples/drupal](examples/drupal) and [examples/wordpress](examples/wordpress) for full working `.lando.yml` files.

## Config reference

| Key | Default | Description |
|---|---|---|
| `php` | `8.3` | PHP version, passed straight to `@lando/php` |
| `framework` | `drupal` | `drupal` or `wordpress`; controls drush vs wp-cli tooling and the default pull mount |
| `webroot` | `.` | Docroot relative to the project root |
| `database` | `mysql:8.0` | Any `@lando/mysql` or `@lando/postgres` version string |
| `drush` | `11` | Drush version constraint installed via Composer (Drupal only) |
| `xdebug` | `false` | Enable Xdebug |
| `composer_version` | `2` | Composer major version |

## Why no dynamic environment/relationship picker like Pantheon/Acquia?

Pantheon and Acquia build a small API client (axios) to fetch a live list of environments and show it as an interactive dropdown before running any container command. I looked at doing the same against the Upsun API, but decided against a hand-rolled client I couldn't test against a real account. Instead, `lando pull` leans entirely on the official `upsun` CLI running *inside* the container — it already knows how to list/verify environments, relationships and mounts, and is the thing Upsun actually maintains. See `scripts/upsun-pull.sh`.
