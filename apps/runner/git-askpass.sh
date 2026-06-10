#!/bin/sh
# Git calls this for credential prompts. The username is already in the remote
# URL (x-access-token), so git only asks for the password — the installation
# token, delivered out-of-band via GIT_PAT on git's own environment.
printf '%s' "$GIT_PAT"
