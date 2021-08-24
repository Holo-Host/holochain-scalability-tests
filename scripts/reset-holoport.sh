#! /usr/bin/env bash
# Script for reseting holochain on holoport to the blank state
# and switching to selected nix-channel
# Use with caution :-)
#
# Usage:
# ./reset-holoport.sh <hp-zt-ip-address> <holoport-channel>
#
# Requires env var SSH_KEY_PATH with path to ssh key which is registered to access holoports

set -e

ssh -o StrictHostKeychecking=no root@$1 -i $SSH_KEY_PATH bash <<EOF
  nix-channel --add https://hydra.holo.host/channel/custom/holo-nixpkgs/$2/holo-nixpkgs
  nix-channel --update
  nixos-rebuild switch

  rm -rf /var/lib/holochain-rsm/
  rm -rf /var/lib/configure-holochain/
  rm -rf /tmp/trycp/
  systemctl restart lair-keystore.service
  systemctl restart configure-holochain.service
EOF
