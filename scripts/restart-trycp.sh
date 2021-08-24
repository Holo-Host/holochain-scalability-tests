#! /usr/bin/env bash
# Script for restarting trycp on holoport.
#
# Usage:
# ./restart-trycp.sh <hp-zt-ip-address>
#
# Requires env var SSH_KEY_PATH with path to ssh key which is registered to access holoports

set -e

ssh -o StrictHostKeychecking=no root@$1 -i $SSH_KEY_PATH bash <<EOF
  systemctl restart trycp-server.service
EOF
