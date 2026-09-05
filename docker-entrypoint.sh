#!/bin/sh
set -eu

if [ "${YTDLP_AUTO_UPDATE:-false}" = "true" ]; then
  ytdlp_path="${YTDLP_PATH:-yt-dlp}"
  case "$ytdlp_path" in
    yt-dlp|/usr/local/bin/yt-dlp)
      package="yt-dlp"
      if [ -n "${YTDLP_UPDATE_VERSION:-}" ]; then
        package="yt-dlp==${YTDLP_UPDATE_VERSION}"
      fi
      if python3 -m pip install --no-cache-dir --break-system-packages --upgrade "$package"; then
        printf '%s\n' "yt-dlp startup update completed (${YTDLP_UPDATE_VERSION:-latest})"
      else
        printf '%s\n' 'yt-dlp startup update failed; continuing with the image version' >&2
      fi
      ;;
    *)
      printf '%s\n' "yt-dlp startup update skipped for custom YTDLP_PATH=$ytdlp_path" >&2
      ;;
  esac
fi

exec "$@"
