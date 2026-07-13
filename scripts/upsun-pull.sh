#!/bin/bash

#
# Pulls the database and/or file mounts from an Upsun environment into the
# local Lando database service and appserver mounts.
#
# This is intentionally CLI-driven: every piece of remote knowledge (which
# environment is active, what relationships/mounts exist) is resolved by the
# official `upsun` CLI at run time rather than by an API call made ahead of
# time from the host. See lib/pull.js for the option definitions that feed
# this script.
#

set -e

# Get the lando logger
. /helpers/log.sh

# Set the module
LANDO_MODULE="upsun"

# Local database connection defaults, set by builders/upsun.js
LANDO_DB_ENGINE=${LANDO_DB_ENGINE:-mysql}
LANDO_DB_USER=${LANDO_DB_USER:-upsun}
LANDO_DB_PASSWORD=${LANDO_DB_PASSWORD:-upsun}
LANDO_DB_NAME=${LANDO_DB_NAME:-upsun}
LANDO_DB_HOST=${LANDO_DB_HOST:-database}

# Option defaults
UPSUN_ENVIRONMENT=""
UPSUN_RELATIONSHIPS=()
UPSUN_MOUNTS=()
UPSUN_AUTH=${UPSUN_CLI_TOKEN}

# PARSE THE ARGZZ
while (( "$#" )); do
  case "$1" in
    --auth|--auth=*)
      if [ "${1##--auth=}" != "$1" ]; then
        UPSUN_AUTH="${1##--auth=}"
        shift
      else
        UPSUN_AUTH=$2
        shift 2
      fi
      ;;
    -e|--environment|--environment=*)
      if [ "${1##--environment=}" != "$1" ]; then
        UPSUN_ENVIRONMENT="${1##--environment=}"
        shift
      else
        UPSUN_ENVIRONMENT=$2
        shift 2
      fi
      ;;
    -r|--relationship|--relationship=*)
      if [ "${1##--relationship=}" != "$1" ]; then
        UPSUN_RELATIONSHIPS=($(echo "${1##--relationship=}" | sed -r 's/[,]+/ /g'))
        shift
      else
        UPSUN_RELATIONSHIPS=($(echo "$2" | sed -r 's/[,]+/ /g'))
        shift 2
      fi
      ;;
    -m|--mount|--mount=*)
      if [ "${1##--mount=}" != "$1" ]; then
        UPSUN_MOUNTS=($(echo "${1##--mount=}" | sed -r 's/[,]+/ /g'))
        shift
      else
        UPSUN_MOUNTS=($(echo "$2" | sed -r 's/[,]+/ /g'))
        shift 2
      fi
      ;;
    --)
      shift
      break
      ;;
    -*|--*=)
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Validate auth
export UPSUN_CLI_TOKEN="$UPSUN_AUTH"
lando_pink "Verifying you are authenticated against Upsun..."
upsun auth:info >/dev/null

# Load an ssh certificate, required before any ssh/rsync-backed command (mount:download)
lando_pink "Loading an ssh certificate..."
upsun ssh-cert:load --no-interaction >/dev/null

# Validate the environment, falling back to its parent if inactive
lando_pink "Verifying the $UPSUN_ENVIRONMENT environment is active..."
if ! upsun environments --pipe --no-interaction 2>/dev/null | grep -x "$UPSUN_ENVIRONMENT" >/dev/null; then
  UPSUN_PARENT=$(upsun environment:info -e "$UPSUN_ENVIRONMENT" parent --no-interaction 2>/dev/null || echo "main")
  lando_yellow "Environment $UPSUN_ENVIRONMENT is inactive... using the parent environment ($UPSUN_PARENT) instead"
  UPSUN_ENVIRONMENT="$UPSUN_PARENT"
fi
lando_green "Verified the $UPSUN_ENVIRONMENT environment is active"

# If relationships or mounts contain "none" then unset the whole thing so we skip
for REL in "${UPSUN_RELATIONSHIPS[@]}"; do
  if [ "$REL" == 'none' ]; then unset UPSUN_RELATIONSHIPS; fi
done
for MOUNT in "${UPSUN_MOUNTS[@]}"; do
  if [ "$MOUNT" == 'none' ]; then unset UPSUN_MOUNTS; fi
done

# If there are no relationships specified then indicate that
if [ ${#UPSUN_RELATIONSHIPS[@]} -eq 0 ]; then
  lando_warn "Looks like you did not pass in any relationships!"
  lando_info "That is not a problem. Here are the relationships defined for this app:"
  upsun relationships -e "$UPSUN_ENVIRONMENT" --no-interaction || true
else
  for REL in "${UPSUN_RELATIONSHIPS[@]}"; do
    IFS=':' read -r -a REL_PARTS <<< "$REL"
    RELATIONSHIP="${REL_PARTS[0]}"
    SCHEMA="${REL_PARTS[1]:-$LANDO_DB_NAME}"

    if [ "$LANDO_DB_ENGINE" == "postgres" ]; then
      lando_pink "Resetting the local $SCHEMA schema..."
      PGPASSWORD="$LANDO_DB_PASSWORD" psql -h "$LANDO_DB_HOST" -U "$LANDO_DB_USER" -d "$LANDO_DB_NAME" -q \
        -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
      lando_pink "Importing data from the $RELATIONSHIP relationship..."
      upsun db:dump -e "$UPSUN_ENVIRONMENT" -r "$RELATIONSHIP" --schema "$SCHEMA" -o --no-interaction \
        | PGPASSWORD="$LANDO_DB_PASSWORD" psql -h "$LANDO_DB_HOST" -U "$LANDO_DB_USER" -d "$LANDO_DB_NAME" -q
    else
      TABLES=$(mysql --user="$LANDO_DB_USER" --password="$LANDO_DB_PASSWORD" --database="$LANDO_DB_NAME" --host="$LANDO_DB_HOST" \
        -e 'SHOW TABLES' | awk '{ print $1}' | grep -v '^Tables' ) || true
      lando_pink "Destroying all current tables in the local database if needed..."
      for t in $TABLES; do
        mysql --user="$LANDO_DB_USER" --password="$LANDO_DB_PASSWORD" --database="$LANDO_DB_NAME" --host="$LANDO_DB_HOST" <<-EOF
          SET FOREIGN_KEY_CHECKS=0;
          DROP VIEW IF EXISTS \`$t\`;
          DROP TABLE IF EXISTS \`$t\`;
EOF
      done
      lando_pink "Importing data from the $RELATIONSHIP relationship..."
      upsun db:dump -e "$UPSUN_ENVIRONMENT" -r "$RELATIONSHIP" --schema "$SCHEMA" -o --no-interaction \
        | mysql --user="$LANDO_DB_USER" --password="$LANDO_DB_PASSWORD" --database="$LANDO_DB_NAME" --host="$LANDO_DB_HOST"
    fi
  done
fi

# If there are no mounts specified then indicate that
if [ ${#UPSUN_MOUNTS[@]} -eq 0 ]; then
  lando_warn "Looks like you did not pass in any mounts!"
  lando_info "That is not a problem. Here are the mounts defined for this app:"
  upsun mount:list -e "$UPSUN_ENVIRONMENT" --no-interaction || true
else
  for MOUNT in "${UPSUN_MOUNTS[@]}"; do
    IFS=':' read -r -a MOUNT_PARTS <<< "$MOUNT"
    SOURCE="${MOUNT_PARTS[0]}"
    TARGET="${MOUNT_PARTS[1]:-$LANDO_SOURCE_DIR/$SOURCE}"
    lando_pink "Downloading files from the $SOURCE mount into $TARGET..."
    mkdir -p "$TARGET"
    upsun mount:download -e "$UPSUN_ENVIRONMENT" --mount "$SOURCE" --target "$TARGET" -y --no-interaction
  done
fi

# Finish up!
lando_green "Pull completed successfully!"
